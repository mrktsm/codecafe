package com.codecafe.backend.service;

import com.codecafe.backend.dto.TextOperation;
import com.codecafe.backend.dto.OperationType;
import com.codecafe.backend.dto.VersionVector;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import java.util.logging.Logger;

@Service
public class OtService {
    private static final Logger logger = Logger.getLogger(OtService.class.getName());
    private static final int MAX_HISTORY_SIZE = 500;

    private String documentContent = "";
    private VersionVector serverVersionVector = new VersionVector(new HashMap<>());
    private final List<TextOperation> operationHistory = new ArrayList<>();
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * Gets the current document content
     */
    public String getDocumentContent() {
        lock.lock();
        try {
            return documentContent;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Gets the current server version vector
     */
    public VersionVector getServerVersionVector() {
        lock.lock();
        try {
            return new VersionVector(new HashMap<>(serverVersionVector.getVersions()));
        } finally {
            lock.unlock();
        }
    }

    /**
     * Process an incoming operation, transform if necessary, and apply to document
     *
     * @param operation The operation to process
     * @return The operation with updated version vector
     */
    public TextOperation processOperation(TextOperation operation) {
        lock.lock();
        try {
            logger.info("Processing operation: " + operation);
            String userId = operation.getUserId();

            // Handle case of null version vector
            if (operation.getBaseVersionVector() == null || operation.getBaseVersionVector().getVersions() == null) {
                VersionVector initialVector = new VersionVector(new HashMap<>());
                operation.setBaseVersionVector(initialVector);
            }

            // Find concurrent operations not known to the client
            List<TextOperation> concurrentOps = findConcurrentOperations(operation);
            logger.info("Found " + concurrentOps.size() + " concurrent operations");

            // Sort operations for consistent transformation
            concurrentOps.sort((a, b) -> {
                // First compare by user ID
                int userCompare = a.getUserId().compareTo(b.getUserId());
                if (userCompare != 0) {
                    return userCompare;
                }
                // Then by version number if from same user
                int versionA = a.getBaseVersionVector().getVersions().getOrDefault(a.getUserId(), 0);
                int versionB = b.getBaseVersionVector().getVersions().getOrDefault(b.getUserId(), 0);
                return Integer.compare(versionA, versionB);
            });

            // Transform operation against all concurrent operations
            TextOperation transformedOp = cloneOperation(operation);
            for (TextOperation concurrentOp : concurrentOps) {
                transformedOp = transformOperation(transformedOp, concurrentOp);
                logger.fine("Transformed against: " + concurrentOp.getId() + ", result: " + transformedOp);
            }

            // Validate the transformed operation
            validateOperation(transformedOp);

            // Apply the operation to the document
            applyOperation(transformedOp);

            // Create a new version vector that includes this operation
            Map<String, Integer> newVersions = new HashMap<>(serverVersionVector.getVersions());
            int userVersion = newVersions.getOrDefault(userId, 0) + 1;
            newVersions.put(userId, userVersion);
            VersionVector newServerVector = new VersionVector(newVersions);

            // Update server state and operation
            serverVersionVector = newServerVector;
            transformedOp.setBaseVersionVector(new VersionVector(newVersions));

            // Add to history with pruning if needed
            operationHistory.add(transformedOp);
            if (operationHistory.size() > MAX_HISTORY_SIZE) {
                operationHistory.subList(0, operationHistory.size() - MAX_HISTORY_SIZE / 2).clear();
            }

            logger.info("New document state: " + documentContent);
            logger.info("New server version vector: " + serverVersionVector);
            return transformedOp;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Find operations in history that the incoming operation hasn't causally seen yet.
     * These are the operations the incoming operation needs to be transformed against.
     * This follows the standard TP2 server-side algorithm principle.
     *
     * @param incomingOp The operation received from a client.
     * @return A list of operations from history to transform incomingOp against.
     */
    private List<TextOperation> findConcurrentOperations(TextOperation incomingOp) {
        List<TextOperation> operationsToTransformAgainst = new ArrayList<>();
        VersionVector clientBaseVector = incomingOp.getBaseVersionVector();

        // If client vector is missing or empty, it hasn't seen anything the server has,
        // so it needs to be transformed against all of the server's history.
        if (clientBaseVector == null || clientBaseVector.getVersions() == null) {
            logger.warning("Incoming op " + incomingOp.getId() + " had null or empty base vector. Transforming against all history.");
            // Return a copy to avoid potential concurrent modification if list grows? Lock should prevent this.
            return new ArrayList<>(this.operationHistory);
        }

        for (TextOperation historyOp : this.operationHistory) {
            // Get the version of the historyOp's author AS KNOWN BY THE INCOMING CLIENT OP
            int historyOpAuthorVersionKnownByClient = clientBaseVector.getVersions().getOrDefault(historyOp.getUserId(), 0);

            // Get the actual server sequence number assigned to the historyOp *for its author*.
            // This version number is stored in the historyOp's *own* baseVersionVector,
            // because that vector represents the server state *after* applying historyOp.
            int historyOpServerSequenceVersion = historyOp.getBaseVersionVector().getVersions().getOrDefault(historyOp.getUserId(), 0);

            // If the server's sequence number for the operation in history is greater than
            // the version the client knew about for that author when creating the incomingOp,
            // then the client hadn't seen historyOp, and incomingOp must be transformed against it.
            if (historyOpServerSequenceVersion > historyOpAuthorVersionKnownByClient) {
                operationsToTransformAgainst.add(historyOp);
            }
        }
        // Logging added for clarity during testing
        if (!operationsToTransformAgainst.isEmpty()) {
            logger.info("Op " + incomingOp.getId() + " (User " + incomingOp.getUserId() + ", BaseVV: " + clientBaseVector + ") needs transformation against " + operationsToTransformAgainst.size() + " history operations.");
            // Optional: Log the IDs of ops being transformed against
            // operationsToTransformAgainst.forEach(op -> logger.fine(" - History Op ID: " + op.getId() + ", User: " + op.getUserId() + ", Server Seq Version: " + op.getBaseVersionVector().getVersions().getOrDefault(op.getUserId(), 0)));
        } else {
            logger.info("Op " + incomingOp.getId() + " (User " + incomingOp.getUserId() + ", BaseVV: " + clientBaseVector + ") requires no transformation against history.");
        }
        return operationsToTransformAgainst;
    }

    /**
     * Check if two operations are concurrent (neither happened before the other)
     */
    private boolean isConcurrent(TextOperation opA, TextOperation opB) {
        return !happenedBefore(opA, opB) && !happenedBefore(opB, opA);
    }

    /**
     * Check if operation A happened before operation B
     */
    private boolean happenedBefore(TextOperation opA, TextOperation opB) {
        VersionVector vectorA = opA.getBaseVersionVector();
        VersionVector vectorB = opB.getBaseVersionVector();

        // Skip if either vector is null
        if (vectorA == null || vectorB == null ||
                vectorA.getVersions() == null || vectorB.getVersions() == null) {
            return false;
        }

        // Check if B knows about all changes in A
        boolean hasChangesNotInB = false;
        for (String userId : vectorA.getVersions().keySet()) {
            int versionInA = vectorA.getVersions().get(userId);
            int versionInB = vectorB.getVersions().getOrDefault(userId, 0);

            if (versionInA > versionInB) {
                hasChangesNotInB = true;
                break;
            }
        }

        if (!hasChangesNotInB) {
            return false;
        }

        // Check if B has additional changes not in A
        for (String userId : vectorB.getVersions().keySet()) {
            int versionInB = vectorB.getVersions().get(userId);
            int versionInA = vectorA.getVersions().getOrDefault(userId, 0);

            if (versionInB > versionInA) {
                return false;
            }
        }

        return true;
    }

    /**
     * Apply an operation to the document
     */
    private void applyOperation(TextOperation operation) {
        StringBuilder sb = new StringBuilder(documentContent);

        // Handle special newline normalization for consistent behavior
        String text = operation.getText();
        if (text != null) {
            text = text.replace("\r\n", "\n");
            operation.setText(text);
        }

        switch (operation.getType()) {
            case INSERT:
                if (operation.getPosition() <= sb.length()) {
                    sb.insert(operation.getPosition(), operation.getText());
                }
                break;
            case DELETE:
                if (operation.getPosition() + operation.getLength() <= sb.length()) {
                    sb.delete(operation.getPosition(), operation.getPosition() + operation.getLength());
                }
                break;
            case REPLACE:
                if (operation.getPosition() + operation.getLength() <= sb.length()) {
                    sb.replace(operation.getPosition(), operation.getPosition() + operation.getLength(), operation.getText());
                }
                break;
        }
        documentContent = sb.toString();
    }

    /**
     * Transforms operation 'clientOp' against 'serverOp' according to OT rules.
     * This ensures that applying serverOp then transformed clientOp yields the
     * same result as applying clientOp then transformed serverOp.
     * (Note: This function computes T(clientOp, serverOp)).
     *
     * @param clientOp The operation to transform (usually from the client or an earlier state).
     * @param serverOp The operation to transform against (usually from server history or a concurrent op).
     * @return The transformed clientOp.
     */
    private TextOperation transformOperation(TextOperation clientOp, TextOperation serverOp) {
        // Clone the operation to avoid modifying the original passed-in object
        TextOperation transformed = cloneOperation(clientOp);

        // Skip transformation only if it's the exact same operation ID.
        // DO NOT skip just because users are the same, as clientOp might need
        // transformation against a previous operation from the same user in serverOp history.
        if (clientOp.getId() != null && clientOp.getId().equals(serverOp.getId())) {
            return transformed;
        }

        switch (serverOp.getType()) {
            case INSERT:
                // Transform position based on the insert.
                transformed.setPosition(transformPositionForInsert(
                        transformed.getPosition(), // Use current position of the op being transformed
                        serverOp.getPosition(),
                        serverOp.getText() != null ? serverOp.getText().length() : 0,
                        clientOp.getUserId(), // Use original clientOp's User ID for tie-breaking consistency
                        serverOp.getUserId()
                ));

                // ** CORRECTED LOGIC **
                // We NO LONGER adjust the *length* of 'transformed' if it is DELETE or REPLACE.
                // A concurrent insert ('serverOp') shifts the position but does not
                // change the number of characters 'transformed' was originally intended to delete/replace.
                break;

            case DELETE:
                // Ignore if serverOp is a delete of length 0 or invalid
                if (serverOp.getLength() == null || serverOp.getLength() <= 0) {
                    break;
                }

                // Capture the state of 'transformed' *before* applying effects of serverOp's DELETE.
                // This is crucial for correctly calculating the length change.
                int posBeforeDeleteTransform = transformed.getPosition();
                int lenBeforeDeleteTransform = transformed.getLength() != null ? transformed.getLength() : 0;

                // 1. Transform position first.
                transformed.setPosition(transformPositionForDelete(
                        posBeforeDeleteTransform, // Use position before this transform step
                        serverOp.getPosition(),
                        serverOp.getLength()
                ));

                // 2. Transform length if 'transformed' is DELETE or REPLACE.
                //    Use the state captured *before* this step's position/length transforms.
                if ((transformed.getType() == OperationType.DELETE || transformed.getType() == OperationType.REPLACE) &&
                        lenBeforeDeleteTransform > 0) {
                    transformed.setLength(transformLengthForDelete(
                            posBeforeDeleteTransform,    // Position *before* this delete transform step
                            lenBeforeDeleteTransform,    // Length *before* this delete transform step
                            serverOp.getPosition(),
                            serverOp.getLength()
                    ));
                }
                break;

            case REPLACE:
                // Ignore invalid or no-op replaces
                if (serverOp.getLength() == null || serverOp.getLength() < 0 || serverOp.getText() == null) {
                    break;
                }

                // Decompose serverOp (Replace) into its Delete and Insert parts
                // and transform 'transformed' against each part sequentially.

                // 1. Create the Delete part of serverOp
                TextOperation deletePart = new TextOperation();
                deletePart.setType(OperationType.DELETE);
                deletePart.setPosition(serverOp.getPosition());
                deletePart.setLength(serverOp.getLength());
                deletePart.setBaseVersionVector(serverOp.getBaseVersionVector()); // Preserve context if needed
                deletePart.setUserId(serverOp.getUserId());
                // deletePart.setId(...) // Usually not needed for intermediate parts

                // 2. Create the Insert part of serverOp
                TextOperation insertPart = new TextOperation();
                insertPart.setType(OperationType.INSERT);
                insertPart.setPosition(serverOp.getPosition()); // Insert happens at the start pos of deleted range
                insertPart.setText(serverOp.getText());
                insertPart.setBaseVersionVector(serverOp.getBaseVersionVector()); // Preserve context if needed
                insertPart.setUserId(serverOp.getUserId());
                // insertPart.setId(...)

                // 3. Transform 'transformed' first against the Delete part...
                TextOperation transformedAfterDelete = transformOperation(transformed, deletePart);
                // 4. ...then transform the result against the Insert part.
                transformed = transformOperation(transformedAfterDelete, insertPart);
                break;
        }

        return transformed;
    }

    /**
     * Transforms a position based on a concurrent INSERT operation, handling tie-breaking.
     *
     * @param position  The position of the operation being transformed.
     * @param insertPos The position of the concurrent insert.
     * @param insertLen The length of the concurrent insert.
     * @param clientId  The User ID of the operation being transformed (for tie-breaking).
     * @param serverId  The User ID of the concurrent insert operation (for tie-breaking).
     * @return The transformed position.
     */
    private int transformPositionForInsert(int position, int insertPos, int insertLen, String clientId, String serverId) {
        if (position < insertPos) {
            // Operation is before the insert, position unaffected.
            return position;
        } else if (position == insertPos) {
            // Concurrent operations at the exact same position. Apply tie-breaking.
            // GOAL: Match frontend logic exactly for convergence.
            // Frontend: comparison < 0 -> position; comparison >= 0 -> position + insertLen
            // Java: compareTo returns <0 if less, 0 if equal, >0 if greater.
            int comparison = clientId.compareTo(serverId);
            // If clientId comes first alphabetically (<0), its operation is considered "first",
            // so its position remains unchanged relative to the insert point.
            // Otherwise (>=0), its operation is considered "after" the insert, shifting right.
            return comparison < 0 ? position : position + insertLen;
        } else { // position > insertPos
            // Operation is after the insert, shift position right.
            return position + insertLen;
        }
    }

    /**
     * Transforms a position based on a concurrent DELETE operation.
     *
     * @param position  The position of the operation being transformed.
     * @param deletePos The starting position of the concurrent delete.
     * @param deleteLen The length of the concurrent delete.
     * @return The transformed position.
     */
    private int transformPositionForDelete(int position, int deletePos, int deleteLen) {
        if (deleteLen <= 0) return position; // Delete of zero length has no effect

        if (position <= deletePos) {
            // Starts before or at the delete range, position unaffected.
            return position;
        } else if (position >= deletePos + deleteLen) {
            // Starts after the delete range, shift position left.
            return position - deleteLen;
        } else {
            // Starts within the delete range, move position to the start of the delete.
            return deletePos;
        }
    }

    /**
     * Transforms the length of a DELETE or REPLACE operation ('a') based on a
     * concurrent DELETE operation ('b'). Calculates the remaining length of 'a'
     * after 'b' removes characters, using overlap calculation.
     *
     * @param aPos      The starting position of operation 'a' (the one being transformed).
     * @param aLen      The length of operation 'a'.
     * @param deletePos The starting position of the concurrent delete ('b').
     * @param deleteLen The length of the concurrent delete ('b').
     * @return The transformed length of operation 'a'.
     */
    private int transformLengthForDelete(int aPos, int aLen, int deletePos, int deleteLen) {
        // Use the simpler overlap calculation method (matches corrected frontend)
        if (aLen <= 0 || deleteLen <= 0) {
            // If the operation being transformed already has no length,
            // or the concurrent delete removes nothing, the length remains unchanged.
            return Math.max(0, aLen); // Ensure non-negative result
        }

        int aEndPos = aPos + aLen;
        int deleteEndPos = deletePos + deleteLen;

        // Calculate the start and end of the overlapping region
        int effectiveStart = Math.max(aPos, deletePos);
        int effectiveEnd = Math.min(aEndPos, deleteEndPos);

        // Calculate the length of the overlap (cannot be negative)
        int overlapLength = Math.max(0, effectiveEnd - effectiveStart);

        // The new length is the original length minus the overlap. Ensure non-negative.
        return Math.max(0, aLen - overlapLength);
    }

    /**
     * Create a deep clone of a TextOperation, ensuring the version vector map is copied.
     * @param operation The operation to clone
     * @return A deep copy of the operation
     */
    private TextOperation cloneOperation(TextOperation operation) {
        if (operation == null) return null;

        TextOperation clone = new TextOperation();
        clone.setId(operation.getId());
        clone.setType(operation.getType());
        clone.setPosition(operation.getPosition());
        clone.setText(operation.getText()); // Strings are immutable, shallow copy is fine
        clone.setLength(operation.getLength()); // Integers are primitive/immutable wrapper
        clone.setUserId(operation.getUserId()); // String

        // Deep copy the version vector
        if (operation.getBaseVersionVector() != null) {
            Map<String, Integer> versionMap = operation.getBaseVersionVector().getVersions();
            Map<String, Integer> versionCopy = (versionMap == null) ? new HashMap<>() : new HashMap<>(versionMap);
            clone.setBaseVersionVector(new VersionVector(versionCopy));
        } else {
            clone.setBaseVersionVector(new VersionVector(new HashMap<>())); // Ensure non-null vector
        }

        return clone;
    }

    /**
     * Validate an operation to ensure it can be applied to the document
     * @param operation The operation to validate
     */
    private void validateOperation(TextOperation operation) {
        // Get the current document length
        int docLength = documentContent.length();

        // Ensure position is within bounds
        if (operation.getPosition() < 0) {
            operation.setPosition(0);
            logger.warning("Adjusted negative position to 0");
        }

        if (operation.getPosition() > docLength) {
            operation.setPosition(docLength);
            logger.warning("Adjusted out-of-bounds position to document length: " + docLength);
        }

        // Validate length for DELETE and REPLACE operations
        if (operation.getType() == OperationType.DELETE || operation.getType() == OperationType.REPLACE) {
            if (operation.getLength() == null || operation.getLength() < 0) {
                operation.setLength(0);
                logger.warning("Adjusted invalid length to 0");
            }

            int endPos = operation.getPosition() + operation.getLength();
            if (endPos > docLength) {
                operation.setLength(docLength - operation.getPosition());
                logger.warning("Adjusted out-of-bounds length to: " + operation.getLength());
            }
        }

        // Validate text for INSERT and REPLACE operations
        if (operation.getType() == OperationType.INSERT || operation.getType() == OperationType.REPLACE) {
            if (operation.getText() == null) {
                operation.setText("");
                logger.warning("Set null text to empty string");
            }
        }
    }

    /**
     * Sets the document content directly (use with caution)
     * @param content The new document content
     */
    public void setDocumentContent(String content) {
        lock.lock();
        try {
            documentContent = content;
            // Reset version vector when setting document content directly
            serverVersionVector = new VersionVector(new HashMap<>());
            operationHistory.clear();
            logger.info("Document content set directly. History cleared.");
        } finally {
            lock.unlock();
        }
    }

    /**
     * Reset the server state completely
     */
    public void reset() {
        lock.lock();
        try {
            documentContent = "";
            serverVersionVector = new VersionVector(new HashMap<>());
            operationHistory.clear();
            logger.info("OT service has been reset");
        } finally {
            lock.unlock();
        }
    }

    /**
     * Gets all operations in the history for debugging
     * @return A list of all operations in history
     */
    public List<TextOperation> getOperationHistory() {
        lock.lock();
        try {
            // Return a copy to avoid external modifications
            return new ArrayList<>(operationHistory);
        } finally {
            lock.unlock();
        }
    }

    /**
     * Get operations that happened after a given version vector
     * @param clientVector The client's version vector
     * @return A list of operations that the client hasn't seen
     */
    public List<TextOperation> getOperationsSince(VersionVector clientVector) {
        lock.lock();
        try {
            List<TextOperation> missingOps = new ArrayList<>();

            if (clientVector == null || clientVector.getVersions() == null) {
                return missingOps;
            }

            for (TextOperation op : operationHistory) {
                // Check if client has seen this operation
                String opUserId = op.getUserId();
                int opVersion = op.getBaseVersionVector().getVersions().getOrDefault(opUserId, 0);
                int clientVersion = clientVector.getVersions().getOrDefault(opUserId, 0);

                if (opVersion > clientVersion) {
                    missingOps.add(cloneOperation(op));
                }
            }

            return missingOps;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Calculate the document state at a specific version vector
     * @param targetVector The version vector to calculate document state for
     * @return The document content at the specified version
     */
    public String getDocumentAtVersion(VersionVector targetVector) {
        lock.lock();
        try {
            if (targetVector == null || targetVector.getVersions() == null) {
                return "";
            }

            // Start with empty document
            StringBuilder tempDoc = new StringBuilder();

            // Find operations that are known by the target version
            List<TextOperation> relevantOps = new ArrayList<>();
            for (TextOperation op : operationHistory) {
                if (isKnownByVector(op, targetVector)) {
                    relevantOps.add(op);
                }
            }

            // Apply operations in order
            for (TextOperation op : relevantOps) {
                applyOperationTo(tempDoc, op);
            }

            return tempDoc.toString();
        } finally {
            lock.unlock();
        }
    }

    /**
     * Check if an operation is known by a version vector
     */
    private boolean isKnownByVector(TextOperation op, VersionVector vector) {
        String opUserId = op.getUserId();
        int opVersion = op.getBaseVersionVector().getVersions().getOrDefault(opUserId, 0) + 1;
        int vectorVersion = vector.getVersions().getOrDefault(opUserId, 0);

        return vectorVersion >= opVersion;
    }

    /**
     * Apply an operation to a StringBuilder
     */
    private void applyOperationTo(StringBuilder doc, TextOperation operation) {
        String text = operation.getText();
        if (text != null) {
            text = text.replace("\r\n", "\n");
        }

        switch (operation.getType()) {
            case INSERT:
                if (operation.getPosition() <= doc.length()) {
                    doc.insert(operation.getPosition(), text);
                }
                break;
            case DELETE:
                if (operation.getPosition() + operation.getLength() <= doc.length()) {
                    doc.delete(operation.getPosition(), operation.getPosition() + operation.getLength());
                }
                break;
            case REPLACE:
                if (operation.getPosition() + operation.getLength() <= doc.length()) {
                    doc.replace(operation.getPosition(), operation.getPosition() + operation.getLength(), text);
                }
                break;
        }
    }
}