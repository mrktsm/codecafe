import { editor, IRange, Selection } from "monaco-editor";
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

  // Get the versions map
  getVersions(): { [userId: string]: number } {
    return { ...this.versions };
  }

  // Set the versions map
  setVersions(versions: { [userId: string]: number } | null): void {
    this.versions = versions ? { ...versions } : {};
  }

  // Update a user's version - matches Java implementation
  update(userId: string, version: number): void {
    const current = this.versions[userId] || 0;
    this.versions[userId] = Math.max(current, version);
  }

  // Check if this vector is concurrent with another - matches Java implementation
  concurrent(other: VersionVector): boolean {
    if (!other || !other.getVersions()) {
      return true;
    }

    // Check if this vector knows about operations in other vector
    const knowsAboutOther = this.knowsAboutVersionVector(other);

    // Check if other vector knows about operations in this vector
    const otherKnowsAboutThis = other.knowsAboutVersionVector(this);

    // They're concurrent if neither fully knows about the other
    return !knowsAboutOther && !otherKnowsAboutThis;
  }

  // Helper method to check if this vector knows about all operations in another vector
  private knowsAboutVersionVector(other: VersionVector): boolean {
    if (!other || !other.getVersions()) {
      return true;
    }

    const otherVersions = other.getVersions();

    for (const userId in otherVersions) {
      const otherVersion = otherVersions[userId];
      const thisVersion = this.versions[userId] || 0;

      // If we have a lower version for any user, we don't know about all their operations
      if (thisVersion < otherVersion) {
        return false;
      }
    }

    return true;
  }

  // Merge this vector with another, taking the maximum version for each user
  merge(other: VersionVector): VersionVector {
    if (!other || !other.getVersions()) {
      return new VersionVector(this.versions);
    }

    const result = new VersionVector(this.versions);
    const otherVersions = other.getVersions();

    for (const userId in otherVersions) {
      const otherVersion = otherVersions[userId];
      const thisVersion = this.versions[userId] || 0;
      result.versions[userId] = Math.max(thisVersion, otherVersion);
    }

    return result;
  }

  // For debugging
  toString(): string {
    return JSON.stringify(this.versions);
  }
}

export interface TextOperation {
  id?: string;
  type: OperationType;
  position: number;
  text?: string;
  length?: number;
  baseVersionVector: { [userId: string]: number }; // Keep as raw object for serialization
  userId: string;
  clone?: () => TextOperation;
}

export interface OperationAck {
  operationId: string;
  baseVersionVector: { [userId: string]: number };
  userId: string;
}

export class TextOperationManager {
  private editor: editor.IStandaloneCodeEditor;
  private model: editor.ITextModel;
  private localVersionVector: VersionVector;
  private pendingOperations: Map<string, TextOperation> = new Map();
  private operationHistory: TextOperation[] = [];
  private userId: string;
  private operationCallback: (op: TextOperation) => void;
  private isApplyingExternalOperation: boolean = false;
  private lastCursorState: editor.ICursorState[] | null = null;

  constructor(
    editor: editor.IStandaloneCodeEditor,
    userId: string,
    initialVersionVector: { [userId: string]: number } = {},
    operationCallback: (op: TextOperation) => void
  ) {
    this.editor = editor;
    this.model = editor.getModel()!;
    this.userId = userId;
    this.localVersionVector = new VersionVector(
      typeof initialVersionVector === "object" && initialVersionVector !== null
        ? initialVersionVector
        : {}
    );
    this.operationCallback = operationCallback;

    // Initialize user's version if not present
    if (!this.localVersionVector.getVersions()[userId]) {
      this.localVersionVector.update(userId, 0);
    }

    this.model.onDidChangeContent((e) => {
      if (!this.isApplyingExternalOperation) {
        this.handleModelContentChange(e);
      }
    });

    // Save cursor state when user moves the cursor
    this.editor.onDidChangeCursorPosition(() => {
      if (!this.isApplyingExternalOperation) {
        this.lastCursorState = this.editor.saveViewState()?.cursorState || null;
      }
    });

    console.log(
      "TextOperationManager initialized with version vector:",
      this.localVersionVector.toString()
    );
  }

  // Add a batching mechanism with a configurable delay
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchedOperations: TextOperation[] = [];
  private batchDelay: number = 0; // milliseconds

  // Replace the handleModelContentChange and processBatch methods with these improved versions

  private handleModelContentChange(e: editor.IModelContentChangedEvent): void {
    const changes = e.changes;
    changes.sort((a, b) => b.rangeOffset - a.rangeOffset);

    for (const change of changes) {
      const operation = this.createOperationFromChange(change);
      if (operation) {
        // Add to batch instead of sending immediately
        this.batchedOperations.push(operation);
      }
    }

    // If we don't have a pending timeout, set one
    if (this.batchTimeout === null) {
      this.batchTimeout = setTimeout(() => {
        this.processBatch();
        this.batchTimeout = null;
      }, this.batchDelay);
    }
    // Optional: Force immediate processing if batch gets too large
    else if (this.batchedOperations.length > 10) {
      clearTimeout(this.batchTimeout);
      this.processBatch();
      this.batchTimeout = null;
    }
  }

  private processBatch(): void {
    if (this.batchedOperations.length === 0) return;

    // Try to coalesce operations of the same type
    const coalesced = this.coalesceOperations(this.batchedOperations);

    for (const operation of coalesced) {
      operation.id = uuidv4();
      operation.baseVersionVector = this.localVersionVector.getVersions();
      this.pendingOperations.set(operation.id, operation);
      this.incrementLocalVersion();
      this.operationCallback(operation);
    }

    this.batchedOperations = [];
  }

  private coalesceOperations(operations: TextOperation[]): TextOperation[] {
    if (operations.length <= 1) return operations;

    const result: TextOperation[] = [];
    let current = operations[0];

    for (let i = 1; i < operations.length; i++) {
      const next = operations[i];

      // Try to merge consecutive inserts
      if (
        current.type === OperationType.INSERT &&
        next.type === OperationType.INSERT &&
        current.position + current.text!.length === next.position
      ) {
        current.text += next.text;
      }
      // Try to merge consecutive deletes
      else if (
        current.type === OperationType.DELETE &&
        next.type === OperationType.DELETE &&
        next.position === current.position
      ) {
        current.length! += next.length!;
      }
      // Can't merge, start a new operation
      else {
        result.push(current);
        current = next;
      }
    }

    result.push(current);
    return result;
  }

  private incrementLocalVersion(): void {
    const versions = this.localVersionVector.getVersions();
    const currentVersion = versions[this.userId] || 0;
    this.localVersionVector.update(this.userId, currentVersion + 1);
  }

  private createOperationFromChange(
    change: editor.IModelContentChange
  ): TextOperation | null {
    const position = change.rangeOffset;
    const length = change.rangeLength;
    const text = change.text;

    // Special handling for newlines to ensure they're preserved
    const normalizedText = text.replace(/\r\n/g, "\n");

    let type: OperationType;
    if (length === 0 && normalizedText.length > 0) {
      type = OperationType.INSERT;
    } else if (length > 0 && normalizedText.length === 0) {
      type = OperationType.DELETE;
    } else if (length > 0 && normalizedText.length > 0) {
      type = OperationType.REPLACE;
    } else {
      return null;
    }

    const operation: TextOperation = {
      type,
      position,
      text: normalizedText.length > 0 ? normalizedText : undefined,
      length: length > 0 ? length : undefined,
      baseVersionVector: {},
      userId: this.userId,
      clone: function () {
        const clone = { ...this };
        clone.baseVersionVector = { ...this.baseVersionVector };
        clone.clone = this.clone;
        return clone;
      },
    };
    return operation;
  }

  public applyOperation(operation: TextOperation): void {
    console.log("Applying operation:", operation);

    // Handle local operations (acknowledged by server)
    if (operation.userId === this.userId) {
      if (operation.id && this.pendingOperations.has(operation.id)) {
        this.pendingOperations.delete(operation.id);
      }
      this.updateVersionVector(operation.baseVersionVector);
      console.log(
        "Updated local version vector:",
        this.localVersionVector.toString()
      );
      return;
    }

    // Save cursor position before applying remote operation
    const previousSelections = this.editor.getSelections() || [];

    // For remote operations
    this.updateVersionVector(operation.baseVersionVector);

    // Find concurrent operations and sort them
    const concurrentOps = this.findConcurrentOperations(operation);
    this.sortOperations(concurrentOps);

    // Transform the operation against all concurrent operations
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

    // Apply the transformed operation to the editor
    this.isApplyingExternalOperation = true;
    try {
      const edits: editor.IIdentifiedSingleEditOperation[] = [];
      const range = this.getOperationRange(transformedOperation);

      console.log(
        `Applying ${operation.type} at position ${operation.position}:`,
        operation
      );
      console.log(`Range: ${JSON.stringify(range)}`);

      if (transformedOperation.type === OperationType.INSERT) {
        edits.push({
          range,
          text: transformedOperation.text || "",
          forceMoveMarkers: false,
        });
      } // ... other cases

      const transformedSelections = this.transformSelections(
        previousSelections,
        transformedOperation
      );
      this.model.pushEditOperations(
        previousSelections,
        edits,
        () => transformedSelections
      );

      console.log("New content:", this.model.getValue());
    } finally {
      this.isApplyingExternalOperation = false;
    }
  }

  private transformSelections(
    selections: Selection[],
    operation: TextOperation
  ): Selection[] {
    if (!selections || selections.length === 0) {
      return [];
    }

    return selections.map((selection) => {
      const startOffset = this.model.getOffsetAt({
        lineNumber: selection.startLineNumber,
        column: selection.startColumn,
      });
      const endOffset = this.model.getOffsetAt({
        lineNumber: selection.endLineNumber,
        column: selection.endColumn,
      });

      // Transform start and end positions
      let newStartOffset = this.transformCursorPosition(startOffset, operation);
      let newEndOffset = this.transformCursorPosition(endOffset, operation);

      // Convert back to line/column positions
      const newStartPos = this.model.getPositionAt(newStartOffset);
      const newEndPos = this.model.getPositionAt(newEndOffset);

      return new Selection(
        newStartPos.lineNumber,
        newStartPos.column,
        newEndPos.lineNumber,
        newEndPos.column
      );
    });
  }

  private transformCursorPosition(
    cursorOffset: number,
    operation: TextOperation
  ): number {
    const cursorPos = this.model.getPositionAt(cursorOffset);
    let newOffset = cursorOffset;

    switch (operation.type) {
      case OperationType.INSERT:
        if (cursorOffset < operation.position) {
          return cursorOffset;
        } else if (cursorOffset === operation.position) {
          return this.userId.localeCompare(operation.userId) <= 0
            ? cursorOffset
            : cursorOffset + (operation.text?.length || 0);
        } else {
          newOffset = cursorOffset + (operation.text?.length || 0);
        }
        break;

      case OperationType.DELETE:
        if (!operation.length) return cursorOffset;

        if (cursorOffset <= operation.position) {
          // Cursor is before or at the delete start - no change
          return cursorOffset;
        } else if (cursorOffset <= operation.position + operation.length) {
          // Cursor is within the deleted range - move to the start of deletion
          return operation.position;
        } else {
          // Cursor is after the deletion - shift it left
          return cursorOffset - operation.length;
        }

      case OperationType.REPLACE:
        if (!operation.length) return cursorOffset;

        if (cursorOffset <= operation.position) {
          // Cursor is before the replace - no change
          return cursorOffset;
        } else if (cursorOffset <= operation.position + operation.length) {
          // Cursor is within the replaced region - move to the end of the new text
          // This is a common strategy for replace operations
          return operation.position + (operation.text?.length || 0);
        } else {
          // Cursor is after the replaced region - adjust by the difference in length
          const lengthDiff = (operation.text?.length || 0) - operation.length;
          return cursorOffset + lengthDiff;
        }
    }

    const newPos = this.model.getPositionAt(newOffset);
    console.log(
      `Cursor moved from ${cursorOffset} (${cursorPos.lineNumber}:${cursorPos.column}) to ${newOffset} (${newPos.lineNumber}:${newPos.column})`
    );
    return newOffset;
  }

  private getOperationRange(operation: TextOperation): IRange {
    const startPosition = this.model.getPositionAt(operation.position);
    let endPosition =
      operation.length && operation.length > 0
        ? this.model.getPositionAt(operation.position + operation.length)
        : startPosition;

    return {
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    };
  }

  public acknowledgeOperation(ack: OperationAck): void {
    console.log("Operation acknowledged:", ack);
    if (this.pendingOperations.has(ack.operationId)) {
      this.pendingOperations.delete(ack.operationId);
    }
    this.updateVersionVector(ack.baseVersionVector);
    console.log(
      "Updated local version vector:",
      this.localVersionVector.toString()
    );
  }

  public getVersionVector(): { [userId: string]: number } {
    return this.localVersionVector.getVersions();
  }

  public setVersionVector(vector: { [userId: string]: number }): void {
    this.localVersionVector = new VersionVector(vector);
    console.log("Version vector set to:", this.localVersionVector.toString());
  }

  private findConcurrentOperations(
    incomingOperation: TextOperation
  ): TextOperation[] {
    const concurrent: TextOperation[] = [];
    const incomingVector = new VersionVector(
      incomingOperation.baseVersionVector
    );
    const processedIds = new Set<string>(); // To avoid duplicates

    // 1. Check local pending operations
    for (const [opId, pendingOp] of this.pendingOperations) {
      // Optimization: All local pending ops are typically transformed against
      // incoming remote ops as they haven't been acknowledged/ordered by the server yet.
      // A stricter check might compare their base vectors, but this is common.
      concurrent.push(pendingOp);
      processedIds.add(opId);
    }

    // 2. Check acknowledged history operations
    for (const historyOp of this.operationHistory) {
      // Don't compare an operation against itself if somehow it ended up here
      if (historyOp.id === incomingOperation.id) continue;
      // Skip ops already included from pending list
      if (historyOp.id && processedIds.has(historyOp.id)) continue;

      const historyVector = new VersionVector(historyOp.baseVersionVector);

      // Check for actual concurrency using version vectors
      if (incomingVector.concurrent(historyVector)) {
        concurrent.push(historyOp);
        if (historyOp.id) processedIds.add(historyOp.id);
      }
      // Optional: Include operations that are causally *after* the incoming op
      // if using certain OT algorithms (like GOTO). Simpler OT often only
      // transforms against concurrent ops. Stick to concurrent for now.
    }

    console.log(
      `Found ${concurrent.length} concurrent ops for incoming op ${incomingOperation.id}`
    );
    return concurrent;
  }

  private updateVersionVector(newVector: { [userId: string]: number }): void {
    if (!newVector) {
      console.warn("Received invalid version vector");
      return;
    }

    const newVersionVector = new VersionVector(newVector);
    this.localVersionVector = this.localVersionVector.merge(newVersionVector);
  }

  // Add this method in TextOperationManager class
  // In TextOperationManager class
  private getTypeOrder(type: OperationType): number {
    // Match Java enum natural order: DELETE (0), INSERT (1), REPLACE (2)
    switch (type) {
      case OperationType.DELETE:
        return 0;
      case OperationType.INSERT:
        return 1;
      case OperationType.REPLACE:
        return 2;
    }
  }

  // Replace the existing sortOperations method
  private sortOperations(operations: TextOperation[]): void {
    operations.sort((a, b) => {
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

        // If we're deleting/replacing text and the insert happened within our range
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
        // Create separate delete and insert operations with proper IDs
        const deletePartOfB: TextOperation = {
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

        // First transform against delete, then against insert - same as backend
        const tempTransformedA = this.transformOperation(
          transformedA,
          deletePartOfB
        );
        transformedA = this.transformOperation(tempTransformedA, insertPartOfB);
        break;
    }

    return transformedA;
  }

  // Client-side (corrected to match server implementation)
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
      // Match Java's compareTo <= 0 logic
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

    // No overlap
    if (endPos <= deletePos || pos >= deleteEndPos) {
      return len;
    }

    // Delete entirely contains operation
    if (pos >= deletePos && endPos <= deleteEndPos) {
      return 0;
    }

    // Operation entirely contains delete
    if (pos <= deletePos && endPos >= deleteEndPos) {
      return len - deleteLen;
    }

    // Delete overlaps with start of operation
    if (pos < deletePos && endPos > deletePos && endPos <= deleteEndPos) {
      return deletePos - pos;
    }

    // Delete overlaps with end of operation
    if (pos >= deletePos && pos < deleteEndPos && endPos > deleteEndPos) {
      return endPos - deleteEndPos;
    }

    // Shouldn't get here
    return 0;
  }

  private validateOperation(operation: TextOperation): void {
    const maxPos = this.model.getValueLength();

    if (!operation.id) operation.id = uuidv4();
    if (!operation.userId) operation.userId = "anonymous";

    if (operation.position < 0) operation.position = 0;
    if (operation.position > maxPos) operation.position = maxPos;

    if (
      operation.type === OperationType.DELETE ||
      operation.type === OperationType.REPLACE
    ) {
      if (operation.length === undefined || operation.length < 0) {
        operation.length = 0;
      }
      const endPos = operation.position + operation.length;
      if (endPos > maxPos) {
        operation.length = maxPos - operation.position;
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
}
