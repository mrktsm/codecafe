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

    return !this.happenedBefore(other) && !other.happenedBefore(this);
  }

  private happenedBefore(other: VersionVector): boolean {
    const thisVersions = this.versions;
    const otherVersions = other.getVersions();

    // Check if this has changes not in other
    let hasChangesNotInOther = false;
    for (const userId in thisVersions) {
      const thisVersion = thisVersions[userId];
      const otherVersion = otherVersions[userId] || 0;

      if (thisVersion > otherVersion) {
        hasChangesNotInOther = true;
        break;
      }
    }

    if (!hasChangesNotInOther) {
      return false;
    }

    // Check if other has additional changes not in this
    for (const userId in otherVersions) {
      const otherVersion = otherVersions[userId];
      const thisVersion = thisVersions[userId] || 0;

      if (otherVersion > thisVersion) {
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
  versionVector: { versions: { [userId: string]: number } };
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

  private handleModelContentChange(e: editor.IModelContentChangedEvent): void {
    const changes = e.changes;
    // Sort changes in reverse order to handle multiple changes correctly
    changes.sort((a, b) => b.rangeOffset - a.rangeOffset);

    for (const change of changes) {
      const operation = this.createOperationFromChange(change);
      if (operation) {
        operation.id = uuidv4();
        operation.baseVersionVector = this.localVersionVector.getVersions();
        this.pendingOperations.set(operation.id, operation);

        // Increment local version for our own operation
        this.incrementLocalVersion();

        console.log("Created operation:", operation);
        this.operationCallback(operation);
      }
    }
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
    // Ensure the operation has a clone method for safety
    if (!operation.clone) {
      operation.clone = function () {
        const clone = { ...this };
        clone.baseVersionVector = { ...this.baseVersionVector };
        clone.clone = this.clone;
        return clone;
      };
    }

    // --- Handling Acknowledged Local Ops (No Change Needed) ---
    if (operation.userId === this.userId) {
      console.log(
        `Received own op ${operation.id} back (treat as potential ack info)`
      );
      // If it's in pending, remove it (ack might arrive separately or this IS the ack info)
      if (operation.id && this.pendingOperations.has(operation.id)) {
        console.log(
          `Removing acknowledged/processed op ${operation.id} from pending.`
        );
        this.pendingOperations.delete(operation.id);
      }
      // Update vector based on the state *after* this op was applied on server
      // Use baseVersionVector assuming it's the server's state *after* applying this op
      this.updateVersionVector(operation.baseVersionVector);
      console.log(
        "Updated local version vector after own op processed:",
        this.localVersionVector.toString()
      );
      return; // Don't apply own op again
    }

    // --- Handling Remote Ops ---
    console.log(
      `Applying remote op ${operation.id} from user ${operation.userId}`
    );
    this.updateVersionVector(operation.baseVersionVector); // Learn what server knew when creating this op

    // Find *local* pending operations that the incoming remote op hasn't causally seen.
    const concurrentPendingOps =
      this.findConcurrentPendingOpsForRemoteOp(operation);
    this.sortOperations(concurrentPendingOps); // Sort for consistent transformation order

    // 1. Transform the incoming remote operation against the concurrent local pending ops
    let transformedRemoteOp = operation.clone(); // Start with a clone
    console.log(
      `Transforming incoming remote op ${transformedRemoteOp.id} against ${concurrentPendingOps.length} pending ops...`
    );
    for (const pendingOp of concurrentPendingOps) {
      transformedRemoteOp = this.transformOperation(
        transformedRemoteOp,
        pendingOp
      );
      console.log(
        ` -> Transformed remote op ${transformedRemoteOp.id} against pending op ${pendingOp.id}`
      );
    }
    console.log(` -> Final transformed remote op:`, transformedRemoteOp);

    // *** ADD THIS SECTION ***
    // 2. Transform the concurrent local pending operations against the *original* incoming remote op
    console.log(
      `Transforming ${concurrentPendingOps.length} pending ops against original remote op ${operation.id}...`
    );
    const nextPendingOperations = new Map<string, TextOperation>(
      this.pendingOperations
    ); // Clone the pending map
    for (const concurrentPendingOp of concurrentPendingOps) {
      const originalPendingOp = this.pendingOperations.get(
        concurrentPendingOp.id!
      );
      if (originalPendingOp) {
        // IMPORTANT: Transform against the *original* incoming operation
        const transformedPendingOp = this.transformOperation(
          originalPendingOp,
          operation
        );
        console.log(
          ` -> Transformed pending op ${originalPendingOp.id} against remote op ${operation.id}`
        );
        console.log(` -> Result:`, transformedPendingOp);
        // Update the operation in our temporary 'next' map
        nextPendingOperations.set(
          transformedPendingOp.id!,
          transformedPendingOp
        );
      } else {
        console.warn(
          `Could not find original pending op with id ${concurrentPendingOp.id} for transformation!`
        );
      }
    }
    // Update the main pending queue with the transformed versions
    this.pendingOperations = nextPendingOperations;
    console.log(" -> Updated pending operations map:", this.pendingOperations);
    // *** END ADDED SECTION ***

    this.validateOperation(transformedRemoteOp); // Validate the op we are about to apply locally

    // --- Apply the transformedRemoteOp to the editor (No Change Needed in this block) ---
    this.isApplyingExternalOperation = true;
    try {
      const previousSelections = this.editor.getSelections() || [];
      const edits: editor.IIdentifiedSingleEditOperation[] = [];
      const range = this.getOperationRange(transformedRemoteOp);

      if (transformedRemoteOp.type === OperationType.INSERT) {
        edits.push({
          range,
          text: transformedRemoteOp.text || "",
          forceMoveMarkers: false,
        });
      } else if (transformedRemoteOp.type === OperationType.DELETE) {
        edits.push({ range, text: "", forceMoveMarkers: false });
      } else if (transformedRemoteOp.type === OperationType.REPLACE) {
        edits.push({
          range,
          text: transformedRemoteOp.text || "",
          forceMoveMarkers: false,
        });
      }

      if (edits.length > 0) {
        const transformedSelections = this.transformSelections(
          previousSelections,
          transformedRemoteOp
        );
        this.model.pushEditOperations(
          previousSelections,
          edits,
          () => transformedSelections
        );
        console.log(
          `Applied transformed remote op ${transformedRemoteOp.id} to editor.`
        );
      } else {
        console.log(
          `Transformed remote op ${transformedRemoteOp.id} resulted in no edit.`
        );
      }

      // Add the *transformed* remote operation to local history (optional, for context/debug)
      this.operationHistory.push(transformedRemoteOp);
      if (this.operationHistory.length > 100) {
        this.operationHistory.shift();
      }

      console.log(
        "Editor updated after remote op. New vector:",
        this.localVersionVector.toString()
      );
    } catch (error) {
      console.error("Error applying remote operation to editor:", error);
      console.error("Operation details:", transformedRemoteOp);
      // Consider adding more robust error handling / state recovery here
    } finally {
      this.isApplyingExternalOperation = false;
    }
  }

  // Renamed and corrected logic for finding pending ops concurrent to an INCOMING remote op
  private findConcurrentPendingOpsForRemoteOp(
    remoteOp: TextOperation
  ): TextOperation[] {
    const concurrent: TextOperation[] = [];
    const remoteOpBaseVector = new VersionVector(remoteOp.baseVersionVector);

    console.log(
      `Finding pending ops concurrent with remote ${remoteOp.id} (User ${
        remoteOp.userId
      }, BaseVV: ${remoteOpBaseVector.toString()})`
    );

    for (const [id, pendingOp] of this.pendingOperations) {
      // A local pendingOp needs transformation if the incoming remoteOp's base vector
      // does not already include the change represented by this pendingOp.

      // Get the version this pendingOp represents for its user.
      // It's the version *after* the op, which is baseVersion + 1.
      const pendingOpUser = pendingOp.userId;
      const pendingOpBaseVersionForUser =
        pendingOp.baseVersionVector[pendingOpUser] || 0;
      const pendingOpRepresentsVersion = pendingOpBaseVersionForUser + 1;

      // Get the version the remoteOp's base vector knows about for the pendingOp's user.
      const remoteKnowsVersionForPendingUser =
        remoteOpBaseVector.getVersions()[pendingOpUser] || 0;

      if (remoteKnowsVersionForPendingUser < pendingOpRepresentsVersion) {
        // The remoteOp's base state does NOT include this pendingOp.
        // Therefore, the remoteOp needs to be transformed against this pendingOp,
        // AND this pendingOp needs to be transformed against the remoteOp.
        console.log(
          `  - Pending op ${id} (User ${pendingOpUser}, represents V ${pendingOpRepresentsVersion}) is concurrent because remote base only knows V ${remoteKnowsVersionForPendingUser}.`
        );
        concurrent.push(pendingOp.clone ? pendingOp.clone() : { ...pendingOp }); // Add a clone
      } else {
        console.log(
          `  - Pending op ${id} (User ${pendingOpUser}, represents V ${pendingOpRepresentsVersion}) is NOT concurrent because remote base knows V ${remoteKnowsVersionForPendingUser}.`
        );
      }
    }
    console.log(`Found ${concurrent.length} concurrent pending ops.`);
    return concurrent;
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
    switch (operation.type) {
      case OperationType.INSERT:
        if (cursorOffset < operation.position) {
          // Cursor is before the insert point - no change
          return cursorOffset;
        } else if (cursorOffset === operation.position) {
          // Cursor is exactly at the insert point - use the same tie-breaking logic
          // as operation transformation for consistency
          if (this.userId === operation.userId) {
            // Same user, place after insert
            return cursorOffset + (operation.text?.length || 0);
          } else {
            const comparison = this.userId.localeCompare(operation.userId);
            if (comparison <= 0) {
              // Our ID is smaller, place before
              return cursorOffset;
            } else {
              // Our ID is larger, place after
              return cursorOffset + (operation.text?.length || 0);
            }
          }
        } else {
          // Cursor is after the insert point - shift it
          return cursorOffset + (operation.text?.length || 0);
        }

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

    return cursorOffset;
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
    this.updateVersionVector(ack.versionVector.versions);
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

  private findConcurrentOperations(operation: TextOperation): TextOperation[] {
    const concurrent: TextOperation[] = [];
    const opVector = new VersionVector(operation.baseVersionVector);

    for (const [_, pendingOp] of this.pendingOperations) {
      const pendingVector = new VersionVector(pendingOp.baseVersionVector);
      if (opVector.concurrent(pendingVector)) {
        concurrent.push(pendingOp);
      }
    }
    return concurrent;
  }

  private updateVersionVector(newVector: { [userId: string]: number }): void {
    if (!newVector) {
      console.warn(
        "Received invalid version vector for line",
        console.log(newVector),
        "operation source:",
        new Error().stack
      );
      return;
    }
    const newVersionVector = new VersionVector(newVector);
    this.localVersionVector = this.localVersionVector.merge(newVersionVector);
  }

  private sortOperations(operations: TextOperation[]): void {
    operations.sort((a, b) => {
      // First compare by user ID for consistency
      const userCompare = a.userId.localeCompare(b.userId);
      if (userCompare !== 0) return userCompare;

      // Then by version number if from same user
      const aVersion = a.baseVersionVector[a.userId] || 0;
      const bVersion = b.baseVersionVector[b.userId] || 0;
      return aVersion - bVersion;
    });
  }

  private transformOperation(
    a: TextOperation,
    b: TextOperation
  ): TextOperation {
    // Clone 'a' to avoid modifying the original object, ensure deep copy of vector
    // Also ensure the clone function itself is copied or recreated.
    let transformedA = a.clone ? a.clone() : { ...a };
    if (!transformedA.clone) {
      transformedA.clone = function () {
        const clone = { ...this };
        clone.baseVersionVector = { ...this.baseVersionVector };
        clone.clone = this.clone;
        return clone;
      };
    }
    // Ensure vector is copied if clone didn't exist
    transformedA.baseVersionVector = { ...a.baseVersionVector };

    // If it's the same operation ID, no transformation needed.
    // This might happen if an operation is reflected back in some way, though
    // applyOperation usually handles filtering own ops. Safety check.
    if (a.id && b.id && a.id === b.id) {
      return transformedA;
    }

    // --- Main transformation logic based on the type of operation 'b' ---
    switch (b.type) {
      case OperationType.INSERT: // b is INSERT
        // Transform the position of 'a' based on 'b's insertion point and length.
        // This uses the helper function which includes tie-breaking logic.
        transformedA.position = this.transformPosition(
          a.position, // Original position of 'a'
          b.position, // Position of 'b's insert
          b.text?.length || 0, // Length of 'b's insert
          true, // isInsert flag (indicates 'b' is an insert)
          a.userId, // User ID of 'a' (for tie-breaking)
          b.userId // User ID of 'b' (for tie-breaking)
        );

        // ** CORRECTED LOGIC **
        // We NO LONGER adjust the *length* of 'a' if 'a' is DELETE or REPLACE.
        // A concurrent insert ('b') shifts the position of 'a' but does not
        // change the number of characters 'a' was originally intended to delete or replace.
        // The previous logic that increased 'a.length' was non-standard and likely incorrect.

        break; // End of case INSERT

      case OperationType.DELETE: // b is DELETE
        // Ignore if b is a delete of length 0
        if (b.length === undefined || b.length <= 0) {
          break;
        }

        // We need 'a's position *before* it's potentially modified by b's delete
        // to correctly calculate the length transformation later.
        const originalAPositionForLengthCalc = a.position;
        const originalALength = a.length; // Store original length too

        // Transform 'a's position based on 'b's deletion range.
        transformedA.position = this.transformPositionAgainstDelete(
          a.position, // Original position of 'a'
          b.position, // Position of 'b's delete
          b.length // Length of 'b's delete
        );

        // If 'a' is also a DELETE or REPLACE, its length might need adjustment
        // due to the characters removed by 'b'.
        if (
          (a.type === OperationType.DELETE ||
            a.type === OperationType.REPLACE) &&
          originalALength !== undefined &&
          originalALength > 0
        ) {
          transformedA.length = this.transformLengthAgainstDelete(
            originalAPositionForLengthCalc, // 'a's position *before* this transform step
            originalALength, // 'a's original length
            b.position, // 'b's delete position
            b.length // 'b's delete length
          );

          // Optional: If a delete/replace length becomes 0, it's effectively a no-op.
          // You could potentially nullify it here, but applying a zero-length op is also fine.
          // if (transformedA.length === 0) { /* maybe change type or flag as no-op */ }
        }
        break; // End of case DELETE

      case OperationType.REPLACE: // b is REPLACE
        // Standard practice: Decompose 'b' (Replace) into its Delete and Insert parts
        // and transform 'a' against each part sequentially.

        // Ignore if b is a replace that effectively changes nothing or is invalid
        if (b.length === undefined || b.length < 0 || b.text === undefined) {
          break;
        }

        // 1. Create the Delete part of 'b'
        const deletePartOfB: TextOperation = {
          type: OperationType.DELETE,
          position: b.position,
          length: b.length,
          baseVersionVector: { ...b.baseVersionVector }, // Copy vector
          userId: b.userId,
          // Generate distinct internal IDs if needed for debugging, otherwise can omit
          // id: b.id ? `${b.id}-delete` : undefined,
          clone: function () {
            /* ... simple clone ... */ return {
              ...this,
              baseVersionVector: { ...this.baseVersionVector },
            };
          },
        };

        // 2. Create the Insert part of 'b' (position is same as delete start)
        const insertPartOfB: TextOperation = {
          type: OperationType.INSERT,
          position: b.position,
          text: b.text,
          baseVersionVector: { ...b.baseVersionVector }, // Copy vector
          userId: b.userId,
          // id: b.id ? `${b.id}-insert` : undefined,
          clone: function () {
            /* ... simple clone ... */ return {
              ...this,
              baseVersionVector: { ...this.baseVersionVector },
            };
          },
        };

        // 3. Transform 'a' against the Delete part first
        const tempTransformedA = this.transformOperation(
          transformedA,
          deletePartOfB
        );

        // 4. Transform the result against the Insert part
        transformedA = this.transformOperation(tempTransformedA, insertPartOfB);
        break; // End of case REPLACE
    }

    return transformedA;
  }

  /**
   * Transforms a position based on a concurrent INSERT operation.
   * Handles tie-breaking using user IDs if the position and insert point match.
   */
  private transformPosition(
    position: number, // Position of the operation being transformed ('a')
    insertPos: number, // Position of the concurrent insert ('b')
    insertLen: number, // Length of the concurrent insert ('b')
    isInsert: boolean, // Flag indicating if 'b' is an insert (used for clarity, always true here)
    aUserId: string, // User ID of operation 'a'
    bUserId: string // User ID of operation 'b'
  ): number {
    if (position < insertPos) {
      // 'a' happens before 'b's insert point, position is unaffected.
      return position;
    } else if (position === insertPos) {
      // 'a' happens exactly at 'b's insert point. Tie-breaking needed.
      // GOAL: Ensure consistent ordering. If user IDs differ, sort by ID.
      //       If user IDs are the same, local op ('a') usually goes after remote ('b')
      //       for cursor predictability, but server logic dictates final order.
      //       Using simple ID comparison for deterministic tie-break:
      const comparison = aUserId.localeCompare(bUserId);
      if (comparison < 0) {
        // 'a's user ID is "smaller", operation 'a' conceptually happens "first".
        // Position remains unchanged relative to the start of 'b's insert.
        return position;
      } else if (comparison > 0) {
        // 'a's user ID is "larger", operation 'a' conceptually happens "after" 'b'.
        // Position is shifted by the length of 'b's insert.
        return position + insertLen;
      } else {
        // User IDs are the same. This means transforming a local pending op
        // against a remote op from the *same user* (less common, but possible with complex merges/resyncs).
        // Or transforming remote vs remote from same user.
        // Let's assume remote ('b') happened first conceptually on the server for consistency.
        // Shift 'a's position after 'b'.
        return position + insertLen;
        // Note: Tie-breaking for same-user ops can have different strategies.
        // Simple ID comparison is the most common deterministic approach.
      }
    } else {
      // position > insertPos
      // 'a' happens after 'b's insert point, shift position right.
      return position + insertLen;
    }
  }

  /**
   * Transforms a position based on a concurrent DELETE operation.
   */
  private transformPositionAgainstDelete(
    position: number, // Position of the operation being transformed ('a')
    deletePos: number, // Position of the concurrent delete ('b')
    deleteLen: number // Length of the concurrent delete ('b')
  ): number {
    if (position <= deletePos) {
      // 'a' starts before or at the beginning of the delete range. Position unaffected.
      return position;
    } else if (position >= deletePos + deleteLen) {
      // 'a' starts after the end of the delete range. Shift position left.
      return position - deleteLen;
    } else {
      // 'a' starts within the delete range. Move position to the start of the delete.
      return deletePos;
    }
  }

  /**
   * Transforms the length of a DELETE or REPLACE operation ('a')
   * based on a concurrent DELETE operation ('b').
   * Calculates the remaining length of 'a' after 'b' removes characters.
   */
  private transformLengthAgainstDelete(
    aPos: number, // Start position of operation 'a' (use the pos *before* transformPositionAgainstDelete)
    aLen: number, // Original length of operation 'a'
    deletePos: number, // Start position of concurrent delete 'b'
    deleteLen: number // Length of concurrent delete 'b'
  ): number {
    if (aLen <= 0) return 0; // Nothing to modify

    const aEndPos = aPos + aLen;
    const deleteEndPos = deletePos + deleteLen;

    // Case 1: No overlap - 'a' ends before 'b' starts, or 'a' starts after 'b' ends.
    if (aEndPos <= deletePos || aPos >= deleteEndPos) {
      return aLen; // Length remains unchanged
    }

    // Case 2: 'b' (delete) completely encompasses 'a'.
    if (deletePos <= aPos && deleteEndPos >= aEndPos) {
      return 0; // 'a's entire range is deleted by 'b'.
    }

    // Case 3: 'a' completely encompasses 'b'.
    if (aPos < deletePos && aEndPos > deleteEndPos) {
      return aLen - deleteLen; // 'a's length is reduced by the length of 'b'.
    }

    // Case 4: 'b' overlaps with the beginning of 'a'.
    if (
      deletePos <= aPos &&
      deleteEndPos > aPos /*&& deleteEndPos < aEndPos*/
    ) {
      // The amount deleted from 'a' is from aPos to deleteEndPos.
      const deletedLength = deleteEndPos - aPos;
      return aLen - deletedLength;
      // Simpler way: the new length is the distance from deleteEndPos to aEndPos.
      // return aEndPos - deleteEndPos; // This is actually wrong. The start pos shifts too.
      // Correct approach for case 4: The start `aPos` gets moved to `deletePos`. The effective length reduces.
      // New length = Original length - overlap. Overlap = deleteEndPos - aPos
      // return aLen - (deleteEndPos - aPos); This seems correct.
    }

    // Case 5: 'b' overlaps with the end of 'a'.
    if (
      /*aPos < deletePos &&*/ aEndPos > deletePos &&
      deleteEndPos >= aEndPos
    ) {
      // The amount deleted from 'a' is from deletePos to aEndPos.
      const deletedLength = aEndPos - deletePos;
      return aLen - deletedLength;
      // Simpler way: the new length is the distance from aPos to deletePos.
      // return deletePos - aPos; // This seems correct for the remaining length.
    }

    // Fallback / Error case - should theoretically be covered by above cases if logic is sound.
    console.warn("Unhandled case in transformLengthAgainstDelete", {
      aPos,
      aLen,
      deletePos,
      deleteLen,
    });
    // Let's re-evaluate cases 4 & 5 logic carefully.

    // --- Re-evaluation of Overlap Cases ---
    let effectiveStart = Math.max(aPos, deletePos);
    let effectiveEnd = Math.min(aEndPos, deleteEndPos);
    let overlapLength = Math.max(0, effectiveEnd - effectiveStart);

    return Math.max(0, aLen - overlapLength); // Reduce original length by the overlap.

    /*
    // Original complex if/else structure - let's replace with simpler overlap calc
    // Delete entirely contains operation
    if (aPos >= deletePos && aEndPos <= deleteEndPos) { return 0; }
    // Operation entirely contains delete
    if (aPos <= deletePos && aEndPos >= deleteEndPos) { return aLen - deleteLen; }
    // Delete overlaps with start of operation (b starts before or at a, ends inside a)
    if (deletePos <= aPos && deleteEndPos > aPos && deleteEndPos < aEndPos) { return aEndPos - deleteEndPos; }
    // Delete overlaps with end of operation (b starts inside a, ends after or at a)
    if (aPos < deletePos && deleteEndPos >= aEndPos && deletePos < aEndPos ) { return deletePos - aPos; }
    */
  }

  private validateOperation(operation: TextOperation): void {
    const maxPos = this.model.getValueLength();

    // Ensure operation has valid ID
    if (!operation.id) {
      operation.id = uuidv4();
      console.warn(`Generated missing operation ID: ${operation.id}`);
    }

    // Ensure user ID is valid
    if (!operation.userId) {
      operation.userId = "anonymous";
      console.warn("Set missing user ID to anonymous");
    }

    // Position validation
    if (operation.position < 0) {
      operation.position = 0;
      console.warn("Adjusted negative position to 0");
    }

    if (operation.position > maxPos) {
      operation.position = maxPos;
      console.warn(
        `Adjusted out-of-bounds position to document length: ${maxPos}`
      );
    }

    // Length validation for DELETE and REPLACE
    if (
      operation.type === OperationType.DELETE ||
      operation.type === OperationType.REPLACE
    ) {
      if (operation.length === undefined) {
        operation.length = 0;
        console.warn("Set undefined length to 0");
      }

      if (operation.length < 0) {
        operation.length = 0;
        console.warn("Adjusted negative length to 0");
      }

      const endPos = operation.position + operation.length;
      if (endPos > maxPos) {
        operation.length = maxPos - operation.position;
        console.warn(`Adjusted out-of-bounds length to: ${operation.length}`);
      }
    }

    // Text validation for INSERT and REPLACE
    if (
      operation.type === OperationType.INSERT ||
      operation.type === OperationType.REPLACE
    ) {
      if (operation.text === undefined) {
        operation.text = "";
        console.warn("Set undefined text to empty string");
      }
    }

    // Make sure base version vector exists
    if (!operation.baseVersionVector) {
      operation.baseVersionVector = {};
      console.warn("Created missing base version vector");
    }
  }
}
