import { editor, IRange, Selection, IPosition } from "monaco-editor";
import { v4 as uuidv4 } from "uuid";

export enum OperationType {
  INSERT = "INSERT",
  DELETE = "DELETE",
  REPLACE = "REPLACE",
}

export class VersionVector {
  private versions: { [userId: string]: number };

  constructor(initialVersions: { [userId: string]: number } = {}) {
    this.versions = { ...initialVersions };
  }

  getVersions(): { [userId: string]: number } {
    return { ...this.versions };
  }

  setVersions(versions: { [userId: string]: number } | null): void {
    this.versions = versions ? { ...versions } : {};
  }

  update(userId: string, version: number): void {
    const current = this.versions[userId] || 0;
    this.versions[userId] = Math.max(current, version);
  }

  concurrent(other: VersionVector): boolean {
    if (!other || !other.getVersions()) return true;
    const knowsAboutOther = this.knowsAboutVersionVector(other);
    const otherKnowsAboutThis = other.knowsAboutVersionVector(this);
    return !knowsAboutOther && !otherKnowsAboutThis;
  }

  private knowsAboutVersionVector(other: VersionVector): boolean {
    if (!other || !other.getVersions()) return true;
    const otherVersions = other.getVersions();
    for (const userId in otherVersions) {
      const otherVersion = otherVersions[userId];
      const thisVersion = this.versions[userId] || 0;
      if (thisVersion < otherVersion) return false;
    }
    return true;
  }

  merge(other: VersionVector): VersionVector {
    if (!other || !other.getVersions()) return new VersionVector(this.versions);
    const result = new VersionVector(this.versions);
    const otherVersions = other.getVersions();
    for (const userId in otherVersions) {
      const otherVersion = otherVersions[userId];
      const thisVersion = this.versions[userId] || 0;
      result.versions[userId] = Math.max(thisVersion, otherVersion);
    }
    return result;
  }

  toString(): string {
    return JSON.stringify(this.versions);
  }
}

export interface TextOperation {
  id?: string;
  lineNumber: number;
  type: OperationType;
  position: number; // Position within the line (0-based)
  text?: string;
  length?: number;
  baseVersionVector: { [userId: string]: number };
  userId: string;
  clone?: () => TextOperation;
}

export interface OperationAck {
  operationId: string;
  lineNumber: number;
  baseVersionVector: { [userId: string]: number };
  userId: string;
}

export interface VersionVectors {
  [lineNumber: number]: { [userId: string]: number };
}

export class TextOperationManager {
  private editor: editor.IStandaloneCodeEditor;
  private model: editor.ITextModel;
  private userId: string;
  private lineVersionVectors: Map<number, VersionVector> = new Map();
  private pendingOperations: Map<string, TextOperation> = new Map();
  private operationHistory: Map<number, TextOperation[]> = new Map();
  private operationCallback: (op: TextOperation) => void;
  private isApplyingExternalOperation: boolean = false;
  private lastCursorState: editor.ICursorState[] | null = null;
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchedOperations: TextOperation[] = [];
  private batchDelay: number = 0; // milliseconds

  constructor(
    editor: editor.IStandaloneCodeEditor,
    userId: string,
    initialVersionVectors: VersionVectors = {},
    operationCallback: (op: TextOperation) => void
  ) {
    this.editor = editor;
    this.model = editor.getModel()!;
    this.userId = userId;
    this.operationCallback = operationCallback;

    this.initializeVersionVectors(initialVersionVectors);

    this.model.onDidChangeContent((e) => {
      if (!this.isApplyingExternalOperation) {
        this.handleModelContentChange(e);
      }
    });

    this.editor.onDidChangeCursorPosition(() => {
      if (!this.isApplyingExternalOperation) {
        this.lastCursorState = this.editor.saveViewState()?.cursorState || null;
      }
    });

    console.log("TextOperationManager initialized");
  }

  private initializeVersionVectors(
    initialVersionVectors: VersionVectors
  ): void {
    const lineCount = this.model.getLineCount();
    for (let i = 1; i <= lineCount; i++) {
      const lineVector = initialVersionVectors[i] || {};
      const versionVector = new VersionVector(lineVector);
      if (!versionVector.getVersions()[this.userId]) {
        versionVector.update(this.userId, 0);
      }
      this.lineVersionVectors.set(i, versionVector);
      this.operationHistory.set(i, []);
    }
  }

  private updateLineStructures(): void {
    const currentLineCount = this.model.getLineCount();
    for (let i = 1; i <= currentLineCount; i++) {
      if (!this.lineVersionVectors.has(i)) {
        const versionVector = new VersionVector();
        versionVector.update(this.userId, 0);
        this.lineVersionVectors.set(i, versionVector);
        this.operationHistory.set(i, []);
      }
    }
    for (const lineNumber of this.lineVersionVectors.keys()) {
      if (lineNumber > currentLineCount) {
        this.lineVersionVectors.delete(lineNumber);
        this.operationHistory.delete(lineNumber);
      }
    }
  }

  public setVersionVector(versions: VersionVectors): void {
    for (const [lineNumber, versionVector] of Object.entries(versions)) {
      const numLineNumber = parseInt(lineNumber, 10);
      const existingVector =
        this.lineVersionVectors.get(numLineNumber) || new VersionVector();
      const newVector = existingVector.merge(new VersionVector(versionVector));
      this.lineVersionVectors.set(numLineNumber, newVector);
    }
    this.updateLineStructures();
  }

  private handleModelContentChange(e: editor.IModelContentChangedEvent): void {
    console.log("Model content changed:", JSON.stringify(e.changes, null, 2));
    const changes = e.changes
      .slice()
      .sort((a, b) => b.rangeOffset - a.rangeOffset);
    for (const change of changes) {
      const startPosition = this.model.getPositionAt(change.rangeOffset);
      const operations = this.createLineOperationsFromChange(
        change,
        startPosition
      );
      for (const operation of operations) {
        this.batchedOperations.push(operation);
      }
    }
    this.updateLineStructures();

    if (this.batchTimeout === null) {
      this.batchTimeout = setTimeout(() => {
        this.processBatch();
        this.batchTimeout = null;
      }, this.batchDelay);
    } else if (this.batchedOperations.length > 10) {
      clearTimeout(this.batchTimeout);
      this.processBatch();
      this.batchTimeout = null;
    }
  }

  private processBatch(): void {
    if (this.batchedOperations.length === 0) return;

    const lineGroups = new Map<number, TextOperation[]>();
    for (const operation of this.batchedOperations) {
      if (!lineGroups.has(operation.lineNumber)) {
        lineGroups.set(operation.lineNumber, []);
      }
      lineGroups.get(operation.lineNumber)!.push(operation);
    }

    const coalescedOperations: TextOperation[] = [];
    for (const [lineNumber, operations] of lineGroups.entries()) {
      operations.sort((a, b) => a.position - b.position);
      const lineCoalescedOps = this.coalesceOperations(operations);
      coalescedOperations.push(...lineCoalescedOps);
    }

    for (const operation of coalescedOperations) {
      operation.id = uuidv4();
      const lineVersionVector = this.getLineVersionVector(operation.lineNumber);
      operation.baseVersionVector = lineVersionVector.getVersions();
      this.pendingOperations.set(operation.id, operation);
      this.incrementLineVersion(operation.lineNumber);
      this.operationCallback(operation);
    }

    this.batchedOperations = [];
  }

  private getLineVersionVector(lineNumber: number): VersionVector {
    if (!this.lineVersionVectors.has(lineNumber)) {
      const versionVector = new VersionVector();
      versionVector.update(this.userId, 0);
      this.lineVersionVectors.set(lineNumber, versionVector);
      this.operationHistory.set(lineNumber, []);
    }
    return this.lineVersionVectors.get(lineNumber)!;
  }

  private incrementLineVersion(lineNumber: number): void {
    const versionVector = this.getLineVersionVector(lineNumber);
    const versions = versionVector.getVersions();
    const currentVersion = versions[this.userId] || 0;
    versionVector.update(this.userId, currentVersion + 1);
  }

  private createLineOperationsFromChange(
    change: editor.IModelContentChange,
    _startPosition: IPosition
  ): TextOperation[] {
    const operations: TextOperation[] = [];
    const range = change.range;
    const text = change.text;
    const rangeLength = change.rangeLength;

    const startLineNumber = range.startLineNumber;
    const startColumn = range.startColumn - 1; // 0-based
    const endLineNumber = range.endLineNumber;
    const endColumn = range.endColumn - 1; // 0-based

    if (text === "") {
      // Deletion
      if (startLineNumber === endLineNumber) {
        // Single-line deletion
        const operation = this.createSingleLineOperation(
          startLineNumber,
          startColumn,
          rangeLength,
          ""
        );
        if (operation) operations.push(operation);
      } else {
        // Multi-line deletion
        let remainingLengthToDelete = rangeLength;
        for (
          let lineNumber = startLineNumber;
          lineNumber <= endLineNumber && remainingLengthToDelete > 0;
          lineNumber++
        ) {
          const lineContent = this.model.getLineContent(lineNumber);
          let startPos = 0;
          let lengthToDeleteOnLine = 0;

          if (lineNumber === startLineNumber) {
            startPos = startColumn;
            lengthToDeleteOnLine = Math.min(
              remainingLengthToDelete,
              lineContent.length -
                startPos +
                (startLineNumber < endLineNumber ? 1 : 0)
            );
          } else if (lineNumber === endLineNumber) {
            lengthToDeleteOnLine = Math.min(
              remainingLengthToDelete,
              endColumn + 1
            );
          } else {
            lengthToDeleteOnLine = Math.min(
              remainingLengthToDelete,
              lineContent.length + 1
            );
          }

          if (lengthToDeleteOnLine > 0) {
            const operation = this.createSingleLineOperation(
              lineNumber,
              startPos,
              lengthToDeleteOnLine,
              ""
            );
            if (operation) operations.push(operation);
            remainingLengthToDelete -= lengthToDeleteOnLine;
          }
        }
      }
    } else {
      // Insertion or Replacement
      if (text.includes("\n")) {
        const textLines = text.split("\n");
        let currentLineNumber = startLineNumber;
        let currentColumn = startColumn;

        for (let i = 0; i < textLines.length; i++) {
          const lineText = textLines[i];
          const lengthToDelete =
            i === 0 && textLines.length === 1 ? rangeLength : 0;

          const operation = this.createSingleLineOperation(
            currentLineNumber,
            currentColumn,
            lengthToDelete,
            lineText
          );
          if (operation) operations.push(operation);

          if (i < textLines.length - 1) {
            currentLineNumber++;
            currentColumn = 0;
          } else {
            currentColumn += lineText.length;
          }
        }
      } else {
        // Single-line insertion
        const operation = this.createSingleLineOperation(
          startLineNumber,
          startColumn,
          rangeLength,
          text
        );
        if (operation) operations.push(operation);
      }
    }

    return operations;
  }
  private createSingleLineOperation(
    lineNumber: number,
    position: number,
    length: number,
    text: string
  ): TextOperation | null {
    const normalizedText = text ? text.replace(/\r\n/g, "\n") : "";
    let type: OperationType;

    console.log(
      "Creating operation - line:",
      lineNumber,
      "position:",
      position,
      "length:",
      length,
      "text:",
      text
    );

    if (length === 0 && normalizedText.length > 0) {
      type = OperationType.INSERT;
    } else if (length > 0 && normalizedText.length === 0) {
      type = OperationType.DELETE;
    } else if (length > 0 && normalizedText.length > 0) {
      type = OperationType.REPLACE;
    } else {
      return null;
    }

    const lineContent = this.model.getLineContent(lineNumber);
    console.log("Line content:", lineContent);
    if (position < 0) position = 0;
    if (position > lineContent.length) position = lineContent.length;
    // No forced capping here; trust the incoming length unless negative
    if (length < 0) length = 0;

    const operation: TextOperation = {
      lineNumber,
      type,
      position,
      text: normalizedText.length > 0 ? normalizedText : undefined,
      length: type === OperationType.INSERT ? undefined : length,
      baseVersionVector: this.getLineVersionVector(lineNumber).getVersions(),
      userId: this.userId,
      clone: function () {
        const clone = { ...this };
        clone.baseVersionVector = { ...this.baseVersionVector };
        clone.clone = this.clone;
        return clone;
      },
    };

    console.log("Final operation:", operation);
    return operation;
  }
  private coalesceOperations(operations: TextOperation[]): TextOperation[] {
    if (operations.length <= 1) return operations;

    const result: TextOperation[] = [];
    let current = operations[0];

    for (let i = 1; i < operations.length; i++) {
      const next = operations[i];
      if (current.lineNumber !== next.lineNumber) {
        result.push(current);
        current = next;
        continue;
      }

      if (
        current.type === OperationType.INSERT &&
        next.type === OperationType.INSERT &&
        current.position + (current.text?.length || 0) === next.position
      ) {
        current.text = (current.text || "") + (next.text || "");
      } else if (
        current.type === OperationType.DELETE &&
        next.type === OperationType.DELETE &&
        next.position === current.position
      ) {
        current.length = (current.length || 0) + (next.length || 0);
      } else {
        result.push(current);
        current = next;
      }
    }
    result.push(current);
    return result;
  }

  public applyOperation(operation: TextOperation): void {
    console.log("Applying operation:", operation);

    if (operation.userId === this.userId) {
      if (operation.id && this.pendingOperations.has(operation.id)) {
        this.pendingOperations.delete(operation.id);
      }
      this.updateLineVersionVector(
        operation.lineNumber,
        operation.baseVersionVector
      );
      console.log(
        `Updated local version vector for line ${operation.lineNumber}:`,
        this.getLineVersionVector(operation.lineNumber).toString()
      );
      return;
    }

    const previousSelections = this.editor.getSelections() || [];
    this.updateLineVersionVector(
      operation.lineNumber,
      operation.baseVersionVector
    );

    const concurrentOps = this.findConcurrentOperations(operation);
    this.sortOperations(concurrentOps);

    let transformedOperation = operation.clone
      ? operation.clone()
      : { ...operation };
    for (const concurrentOp of concurrentOps) {
      transformedOperation = this.transformOperation(
        transformedOperation,
        concurrentOp
      );
    }

    this.validateOperation(transformedOperation);

    if (
      transformedOperation.type === OperationType.DELETE &&
      (transformedOperation.length === undefined ||
        transformedOperation.length <= 0)
    ) {
      console.warn(
        "Skipping delete operation with invalid length:",
        transformedOperation
      );
      return;
    }

    this.isApplyingExternalOperation = true;
    try {
      const edits: editor.IIdentifiedSingleEditOperation[] = [];
      const range = this.getOperationRange(transformedOperation);

      if (transformedOperation.type === OperationType.INSERT) {
        edits.push({
          range,
          text: transformedOperation.text || "",
          forceMoveMarkers: false,
        });
      } else if (transformedOperation.type === OperationType.DELETE) {
        edits.push({ range, text: "", forceMoveMarkers: false });
      } else if (transformedOperation.type === OperationType.REPLACE) {
        edits.push({
          range,
          text: transformedOperation.text || "",
          forceMoveMarkers: false,
        });
      }

      const transformedSelections = this.transformSelections(
        previousSelections,
        transformedOperation
      );
      this.model.pushEditOperations(
        previousSelections,
        edits,
        () => transformedSelections
      );

      const lineHistory =
        this.operationHistory.get(transformedOperation.lineNumber) || [];
      lineHistory.push(transformedOperation);
      if (lineHistory.length > 50) lineHistory.shift();
      this.operationHistory.set(transformedOperation.lineNumber, lineHistory);

      console.log(
        `Line ${transformedOperation.lineNumber} updated, new version vector:`,
        this.getLineVersionVector(transformedOperation.lineNumber).toString()
      );
    } finally {
      this.isApplyingExternalOperation = false;
    }
  }

  private getOperationRange(operation: TextOperation): IRange {
    const startColumn = operation.position + 1;
    const endColumn =
      (operation.type === OperationType.DELETE ||
        operation.type === OperationType.REPLACE) &&
      operation.length !== undefined
        ? operation.position + operation.length + 1
        : startColumn;

    return {
      startLineNumber: operation.lineNumber,
      startColumn,
      endLineNumber: operation.lineNumber,
      endColumn,
    };
  }

  private transformSelections(
    selections: Selection[],
    operation: TextOperation
  ): Selection[] {
    if (!selections || selections.length === 0) return [];

    return selections.map((selection) => {
      if (
        selection.startLineNumber !== operation.lineNumber &&
        selection.endLineNumber !== operation.lineNumber
      ) {
        return selection;
      }

      let newStartLineNumber = selection.startLineNumber;
      let newStartColumn = selection.startColumn;
      let newEndLineNumber = selection.endLineNumber;
      let newEndColumn = selection.endColumn;

      if (selection.startLineNumber === operation.lineNumber) {
        newStartColumn =
          this.transformCursorColumnPosition(
            selection.startColumn - 1,
            operation
          ) + 1;
      }
      if (selection.endLineNumber === operation.lineNumber) {
        newEndColumn =
          this.transformCursorColumnPosition(
            selection.endColumn - 1,
            operation
          ) + 1;
      }

      return new Selection(
        newStartLineNumber,
        newStartColumn,
        newEndLineNumber,
        newEndColumn
      );
    });
  }

  private transformCursorColumnPosition(
    cursorColumn: number,
    operation: TextOperation
  ): number {
    let newColumn = cursorColumn;

    switch (operation.type) {
      case OperationType.INSERT:
        if (cursorColumn < operation.position) {
          return cursorColumn;
        } else if (cursorColumn === operation.position) {
          return this.userId.localeCompare(operation.userId) <= 0
            ? cursorColumn
            : cursorColumn + (operation.text?.length || 0);
        } else {
          newColumn = cursorColumn + (operation.text?.length || 0);
        }
        break;

      case OperationType.DELETE:
        if (!operation.length) return cursorColumn;
        if (cursorColumn <= operation.position) {
          return cursorColumn;
        } else if (cursorColumn <= operation.position + operation.length) {
          return operation.position;
        } else {
          return cursorColumn - operation.length;
        }

      case OperationType.REPLACE:
        if (!operation.length) return cursorColumn;
        if (cursorColumn <= operation.position) {
          return cursorColumn;
        } else if (cursorColumn <= operation.position + operation.length) {
          return operation.position + (operation.text?.length || 0);
        } else {
          const lengthDiff = (operation.text?.length || 0) - operation.length;
          return cursorColumn + lengthDiff;
        }
    }
    return newColumn;
  }

  public acknowledgeOperation(ack: OperationAck): void {
    console.log("Operation acknowledged:", ack);
    if (this.pendingOperations.has(ack.operationId)) {
      this.pendingOperations.delete(ack.operationId);
    }
    this.updateLineVersionVector(ack.lineNumber, ack.baseVersionVector);
    console.log(
      `Updated local version vector for line ${ack.lineNumber}:`,
      this.getLineVersionVector(ack.lineNumber).toString()
    );
  }

  private updateLineVersionVector(
    lineNumber: number,
    newVector: { [userId: string]: number }
  ): void {
    if (!newVector) {
      console.warn("Received invalid version vector");
      return;
    }
    const currentVector = this.getLineVersionVector(lineNumber);
    const newVersionVector = new VersionVector(newVector);
    const mergedVector = currentVector.merge(newVersionVector);
    this.lineVersionVectors.set(lineNumber, mergedVector);
  }

  private findConcurrentOperations(
    incomingOperation: TextOperation
  ): TextOperation[] {
    const concurrent: TextOperation[] = [];
    const lineNumber = incomingOperation.lineNumber;
    const incomingVector = new VersionVector(
      incomingOperation.baseVersionVector
    );
    const processedIds = new Set<string>();

    for (const [opId, pendingOp] of this.pendingOperations) {
      if (pendingOp.lineNumber === lineNumber) {
        concurrent.push(pendingOp);
        processedIds.add(opId);
      }
    }

    const lineHistory = this.operationHistory.get(lineNumber) || [];
    for (const historyOp of lineHistory) {
      if (historyOp.id === incomingOperation.id) continue;
      if (historyOp.id && processedIds.has(historyOp.id)) continue;

      const historyVector = new VersionVector(historyOp.baseVersionVector);
      if (incomingVector.concurrent(historyVector)) {
        concurrent.push(historyOp);
        if (historyOp.id) processedIds.add(historyOp.id);
      }
    }

    console.log(
      `Found ${concurrent.length} concurrent ops for incoming op ${incomingOperation.id} on line ${lineNumber}`
    );
    return concurrent;
  }

  private getTypeOrder(type: OperationType): number {
    switch (type) {
      case OperationType.DELETE:
        return 0;
      case OperationType.INSERT:
        return 1;
      case OperationType.REPLACE:
        return 2;
    }
  }

  private sortOperations(operations: TextOperation[]): void {
    operations.sort((a, b) => {
      const lineCompare = a.lineNumber - b.lineNumber;
      if (lineCompare !== 0) return lineCompare;
      const posCompare = a.position - b.position;
      if (posCompare !== 0) return posCompare;
      const typeCompare = this.getTypeOrder(a.type) - this.getTypeOrder(b.type);
      if (typeCompare !== 0) return typeCompare;
      return a.userId.localeCompare(b.userId);
    });
  }

  private transformOperation(
    a: TextOperation,
    b: TextOperation
  ): TextOperation {
    if (a.lineNumber !== b.lineNumber) {
      return a.clone ? a.clone() : { ...a };
    }

    let transformedA = a.clone ? a.clone() : { ...a };
    const originalA = a;

    if (!transformedA.clone) {
      transformedA.clone = function () {
        const clone = { ...this };
        clone.baseVersionVector = { ...this.baseVersionVector };
        clone.clone = this.clone;
        return clone;
      };
    }

    if (a.id === b.id) return transformedA;

    if (
      (transformedA.type === OperationType.DELETE ||
        transformedA.type === OperationType.REPLACE) &&
      transformedA.length === undefined
    ) {
      transformedA.length = 0;
    }

    switch (b.type) {
      case OperationType.INSERT:
        transformedA.position = this.transformPosition(
          transformedA.position,
          b.position,
          b.text?.length || 0,
          true,
          originalA.userId,
          b.userId
        );
        if (
          (transformedA.type === OperationType.DELETE ||
            transformedA.type === OperationType.REPLACE) &&
          transformedA.length !== undefined
        ) {
          const aEnd = transformedA.position + transformedA.length;
          if (b.position >= transformedA.position && b.position <= aEnd) {
            transformedA.length += b.text?.length || 0;
          }
        }
        break;

      case OperationType.DELETE:
        if (b.length === undefined) break;
        transformedA.position = this.transformPositionAgainstDelete(
          transformedA.position,
          b.position,
          b.length
        );
        if (
          (transformedA.type === OperationType.DELETE ||
            transformedA.type === OperationType.REPLACE) &&
          transformedA.length !== undefined
        ) {
          transformedA.length = this.transformLengthAgainstDelete(
            transformedA.position,
            transformedA.length,
            b.position,
            b.length
          );
        }
        break;

      case OperationType.REPLACE:
        if (b.length === undefined) break;
        const deletePartOfB: TextOperation = {
          lineNumber: b.lineNumber,
          type: OperationType.DELETE,
          position: b.position,
          length: b.length,
          baseVersionVector: { ...b.baseVersionVector },
          userId: b.userId,
          id: b.id ? `${b.id}-delete` : undefined,
          clone: function () {
            const clone = { ...this };
            clone.baseVersionVector = { ...this.baseVersionVector };
            clone.clone = this.clone;
            return clone;
          },
        };
        const insertPartOfB: TextOperation = {
          lineNumber: b.lineNumber,
          type: OperationType.INSERT,
          position: b.position,
          text: b.text,
          baseVersionVector: { ...b.baseVersionVector },
          userId: b.userId,
          id: b.id ? `${b.id}-insert` : undefined,
          clone: function () {
            const clone = { ...this };
            clone.baseVersionVector = { ...this.baseVersionVector };
            clone.clone = this.clone;
            return clone;
          },
        };
        const tempTransformedA = this.transformOperation(
          transformedA,
          deletePartOfB
        );
        transformedA = this.transformOperation(tempTransformedA, insertPartOfB);
        break;
    }

    return transformedA;
  }

  private transformPosition(
    position: number,
    otherPosition: number,
    otherLength: number,
    isInsert: boolean,
    clientUserId: string,
    serverUserId: string
  ): number {
    if (position < otherPosition) {
      return position;
    } else if (position === otherPosition && isInsert) {
      return clientUserId.localeCompare(serverUserId) <= 0
        ? position
        : position + otherLength;
    } else {
      return position + otherLength;
    }
  }

  private transformPositionAgainstDelete(
    position: number,
    deletePos: number,
    deleteLen: number
  ): number {
    if (position <= deletePos) {
      return position;
    } else if (position >= deletePos + deleteLen) {
      return position - deleteLen;
    } else {
      return deletePos;
    }
  }

  private transformLengthAgainstDelete(
    pos: number,
    len: number,
    deletePos: number,
    deleteLen: number
  ): number {
    const endPos = pos + len;
    const deleteEndPos = deletePos + deleteLen;

    if (endPos <= deletePos || pos >= deleteEndPos) return len;
    if (pos >= deletePos && endPos <= deleteEndPos) return 0;
    if (pos <= deletePos && endPos >= deleteEndPos) return len - deleteLen;
    if (pos < deletePos && endPos <= deleteEndPos) return deletePos - pos;
    if (pos >= deletePos && pos < deleteEndPos && endPos > deleteEndPos)
      return endPos - deleteEndPos;
    return 0;
  }

  private validateOperation(operation: TextOperation): void {
    const lineLength = this.model.getLineContent(operation.lineNumber).length;
    if (!operation.id) operation.id = uuidv4();
    if (!operation.userId) operation.userId = "anonymous";
    if (operation.position < 0) operation.position = 0;
    if (operation.position > lineLength) operation.position = lineLength;

    if (
      operation.type === OperationType.DELETE ||
      operation.type === OperationType.REPLACE
    ) {
      if (operation.length === undefined || operation.length < 0) {
        operation.length = 0;
      }
      const endPos = operation.position + operation.length;
      if (endPos > lineLength) {
        operation.length = lineLength - operation.position;
      }
    }

    if (
      operation.type === OperationType.INSERT ||
      operation.type === OperationType.REPLACE
    ) {
      if (operation.text === undefined) operation.text = "";
    }

    if (!operation.baseVersionVector) operation.baseVersionVector = {};
  }

  public getLineVersionVectors(): Map<number, VersionVector> {
    return new Map(this.lineVersionVectors);
  }

  public getPendingOperations(): Map<string, TextOperation> {
    return new Map(this.pendingOperations);
  }

  public getOperationHistory(lineNumber: number): TextOperation[] {
    return [...(this.operationHistory.get(lineNumber) || [])];
  }
}
