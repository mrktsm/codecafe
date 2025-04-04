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

    // Document as a list of lines (line numbers are 0-based)
    private List<String> documentLines = new ArrayList<>();
    // Version vectors per line
    private Map<Integer, VersionVector> lineVersionVectors = new HashMap<>();
    // Operation history per line
    private Map<Integer, List<TextOperation>> lineOperationHistory = new HashMap<>();
    private final ReentrantLock lock = new ReentrantLock();

    public OtService() {
        // Initialize with an empty line
        documentLines.add("");
        lineVersionVectors.put(0, new VersionVector(new HashMap<>()));
        lineOperationHistory.put(0, new ArrayList<>());
    }

    /**
     * Gets the current document content as a single string
     */
    public String getDocumentContent() {
        lock.lock();
        try {
            return String.join("\n", documentLines);
        } finally {
            lock.unlock();
        }
    }

    /**
     * Gets the current document content as a list of lines
     */
    public List<String> getDocumentLines() {
        lock.lock();
        try {
            return new ArrayList<>(documentLines);
        } finally {
            lock.unlock();
        }
    }

    /**
     * Gets the version vectors for all lines
     */
    public Map<Integer, VersionVector> getLineVersionVectors() {
        lock.lock();
        try {
            Map<Integer, VersionVector> copy = new HashMap<>();
            for (Map.Entry<Integer, VersionVector> entry : lineVersionVectors.entrySet()) {
                copy.put(entry.getKey(), new VersionVector(new HashMap<>(entry.getValue().getVersions())));
            }
            return copy;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Process an incoming operation, transform if necessary, and apply to the specific line
     */
    public TextOperation processOperation(TextOperation operation) {
        lock.lock();
        try {
            logger.info("Processing operation: " + operation);
            int lineNumber = operation.getLineNumber() - 1; // Convert to 0-based index
            String userId = operation.getUserId();

            // Ensure the line exists
            ensureLineExists(lineNumber);

            // Handle null version vector
            if (operation.getBaseVersionVector() == null || operation.getBaseVersionVector().getVersions() == null) {
                operation.setBaseVersionVector(new VersionVector(new HashMap<>()));
            }

            // Find concurrent operations for this line
            List<TextOperation> concurrentOps = findConcurrentOperations(operation, lineNumber);
            logger.info("Found " + concurrentOps.size() + " concurrent operations for line " + (lineNumber + 1));

            // Sort concurrent operations
            concurrentOps.sort((a, b) -> {
                int posCompare = Integer.compare(a.getPosition(), b.getPosition());
                if (posCompare != 0) return posCompare;
                int typeCompare = a.getType().compareTo(b.getType());
                if (typeCompare != 0) return typeCompare;
                return a.getUserId().compareTo(b.getUserId());
            });

            // Transform operation against concurrent operations
            TextOperation transformedOp = cloneOperation(operation);
            for (TextOperation concurrentOp : concurrentOps) {
                logger.info("Transforming against: " + concurrentOp);
                transformedOp = transformOperation(transformedOp, concurrentOp);
                logger.info("After transformation: " + transformedOp);
            }

            // Validate the transformed operation
            validateOperation(transformedOp, lineNumber);

            // Apply the operation to the line
            applyOperation(transformedOp, lineNumber);

            // Update version vector for this line
            VersionVector lineVector = lineVersionVectors.get(lineNumber);
            Map<String, Integer> newVersions = new HashMap<>(lineVector.getVersions());
            int userVersion = newVersions.getOrDefault(userId, 0) + 1;
            newVersions.put(userId, userVersion);
            VersionVector newLineVector = new VersionVector(newVersions);
            lineVersionVectors.put(lineNumber, newLineVector);
            transformedOp.setBaseVersionVector(new VersionVector(newVersions));

            // Add to line history with pruning
            List<TextOperation> history = lineOperationHistory.get(lineNumber);
            history.add(transformedOp);
            if (history.size() > MAX_HISTORY_SIZE) {
                history.subList(0, history.size() - MAX_HISTORY_SIZE / 2).clear();
            }

            logger.info("New line " + (lineNumber + 1) + " state: " + documentLines.get(lineNumber));
            logger.info("New version vector for line " + (lineNumber + 1) + ": " + newLineVector);
            return transformedOp;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Ensure the document has enough lines up to the given line number
     */
    private void ensureLineExists(int lineNumber) {
        while (documentLines.size() <= lineNumber) {
            documentLines.add("");
            int newLineNumber = documentLines.size() - 1;
            lineVersionVectors.put(newLineNumber, new VersionVector(new HashMap<>()));
            lineOperationHistory.put(newLineNumber, new ArrayList<>());
        }
    }

    /**
     * Find concurrent operations for a specific line
     */
    private List<TextOperation> findConcurrentOperations(TextOperation operation, int lineNumber) {
        List<TextOperation> concurrent = new ArrayList<>();
        VersionVector clientVector = operation.getBaseVersionVector();

        if (clientVector == null || clientVector.getVersions() == null) {
            return new ArrayList<>();
        }

        List<TextOperation> history = lineOperationHistory.getOrDefault(lineNumber, new ArrayList<>());
        for (TextOperation historyOp : history) {
            if (historyOp.getUserId().equals(operation.getUserId())) {
                continue;
            }
            if (isConcurrent(operation, historyOp)) {
                concurrent.add(historyOp);
            }
        }
        return concurrent;
    }

    /**
     * Check if two operations are concurrent
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

        if (vectorA == null || vectorB == null || vectorA.getVersions() == null || vectorB.getVersions() == null) {
            return false;
        }

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
     * Apply an operation to a specific line
     */
    private void applyOperation(TextOperation operation, int lineNumber) {
        StringBuilder sb = new StringBuilder(documentLines.get(lineNumber));
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
        documentLines.set(lineNumber, sb.toString());
    }

    /**
     * Transform an operation against another operation
     */
    private TextOperation transformOperation(TextOperation clientOp, TextOperation serverOp) {
        TextOperation transformed = cloneOperation(clientOp);

        if (clientOp.getUserId().equals(serverOp.getUserId()) ||
                (clientOp.getId() != null && clientOp.getId().equals(serverOp.getId()))) {
            return transformed;
        }

        logger.info("Transforming client op (" + clientOp.getUserId() + "): " + clientOp.getType() + " at " + clientOp.getPosition() +
                " against server op (" + serverOp.getUserId() + "): " + serverOp.getType() + " at " + serverOp.getPosition());

        int currentPos = transformed.getPosition();
        Integer currentLen = transformed.getLength();

        switch (serverOp.getType()) {
            case INSERT:
                transformed.setPosition(transformPositionForInsert(
                        currentPos,
                        serverOp.getPosition(),
                        serverOp.getText().length(),
                        transformed.getUserId(),
                        serverOp.getUserId()
                ));
                break;

            case DELETE:
                transformed.setPosition(transformPositionForDelete(
                        currentPos,
                        serverOp.getPosition(),
                        serverOp.getLength()
                ));
                if (currentLen != null && (transformed.getType() == OperationType.DELETE || transformed.getType() == OperationType.REPLACE)) {
                    transformed.setLength(transformLengthForDelete(
                            transformed.getPosition(),
                            currentLen,
                            serverOp.getPosition(),
                            serverOp.getLength()
                    ));
                }
                break;

            case REPLACE:
                TextOperation deletePart = new TextOperation();
                deletePart.setType(OperationType.DELETE);
                deletePart.setPosition(serverOp.getPosition());
                deletePart.setLength(serverOp.getLength());
                deletePart.setUserId(serverOp.getUserId());
                deletePart.setBaseVersionVector(serverOp.getBaseVersionVector());

                TextOperation insertPart = new TextOperation();
                insertPart.setType(OperationType.INSERT);
                insertPart.setPosition(serverOp.getPosition());
                insertPart.setText(serverOp.getText());
                insertPart.setUserId(serverOp.getUserId());
                insertPart.setBaseVersionVector(serverOp.getBaseVersionVector());

                logger.info("Decomposing server REPLACE. Transforming against DELETE part...");
                TextOperation transformedAfterDelete = transformOperation(transformed, deletePart);
                logger.info("Decomposing server REPLACE. Transforming against INSERT part...");
                transformed = transformOperation(transformedAfterDelete, insertPart);
                return transformed;
        }

        logger.info("Transformation result: " + transformed.getType() + " at " + transformed.getPosition() +
                " (Length: " + transformed.getLength() + ")");
        return transformed;
    }

    private int transformPositionForInsert(int position, int insertPos, int insertLen, String clientId, String serverId) {
        if (position < insertPos) {
            return position;
        } else if (position == insertPos) {
            return clientId.compareTo(serverId) <= 0 ? position : position + insertLen;
        } else {
            return position + insertLen;
        }
    }

    private int transformPositionForDelete(int position, int deletePos, int deleteLen) {
        if (position <= deletePos) {
            return position;
        } else if (position >= deletePos + deleteLen) {
            return position - deleteLen;
        } else {
            return deletePos;
        }
    }

    private int transformLengthForDelete(int pos, int len, int deletePos, int deleteLen) {
        int endPos = pos + len;
        int deleteEndPos = deletePos + deleteLen;

        if (endPos <= deletePos || pos >= deleteEndPos) {
            return len; // No overlap, keep original length
        }
        if (pos >= deletePos && endPos <= deleteEndPos) {
            return 0; // Fully overlapped, no deletion left
        }
        if (pos <= deletePos && endPos >= deleteEndPos) {
            return len - deleteLen; // Server delete is within client range
        }
        if (pos < deletePos && endPos > deletePos && endPos <= deleteEndPos) {
            return deletePos - pos; // Partial overlap, delete up to server delete start
        }
        if (pos >= deletePos && pos < deleteEndPos && endPos > deleteEndPos) {
            return endPos - deleteEndPos; // Partial overlap, delete after server delete end
        }
        return Math.max(1, len); // Default to at least 1 if transformation fails
    }

    private TextOperation cloneOperation(TextOperation operation) {
        TextOperation clone = new TextOperation();
        clone.setId(operation.getId());
        clone.setLineNumber(operation.getLineNumber());
        clone.setType(operation.getType());
        clone.setPosition(operation.getPosition());
        clone.setText(operation.getText());
        clone.setLength(operation.getLength());
        clone.setUserId(operation.getUserId());

        if (operation.getBaseVersionVector() != null) {
            Map<String, Integer> versionCopy = new HashMap<>();
            if (operation.getBaseVersionVector().getVersions() != null) {
                versionCopy.putAll(operation.getBaseVersionVector().getVersions());
            }
            clone.setBaseVersionVector(new VersionVector(versionCopy));
        }

        return clone;
    }

    private void validateOperation(TextOperation operation, int lineNumber) {
        String lineContent = documentLines.get(lineNumber);
        int lineLength = lineContent.length();

        if (operation.getPosition() < 0) {
            operation.setPosition(0);
            logger.warning("Adjusted negative position to 0");
        }
        if (operation.getPosition() > lineLength) {
            operation.setPosition(lineLength);
            logger.warning("Adjusted out-of-bounds position to line length: " + lineLength);
        }

        if (operation.getType() == OperationType.DELETE || operation.getType() == OperationType.REPLACE) {
            if (operation.getLength() == null) {
                operation.setLength(1); // Default to 1 instead of 0 if null
                logger.warning("Set null length to 1");
            } else if (operation.getLength() < 0) {
                operation.setLength(0);
                logger.warning("Adjusted negative length to 0");
            }
            int endPos = operation.getPosition() + operation.getLength();
            if (endPos > lineLength) {
                int adjustedLength = lineLength - operation.getPosition();
                if (adjustedLength > 0) { // Only adjust if there's something to delete
                    operation.setLength(adjustedLength);
                    logger.warning("Adjusted out-of-bounds length to: " + operation.getLength());
                } else {
                    operation.setLength(0); // No deletion if position is at end
                }
            }
        }

        if (operation.getType() == OperationType.INSERT || operation.getType() == OperationType.REPLACE) {
            if (operation.getText() == null) {
                operation.setText("");
                logger.warning("Set null text to empty string");
            }
        }
    }

    /**
     * Sets the document content directly from a string (splits into lines)
     */
    public void setDocumentContent(String content) {
        lock.lock();
        try {
            String[] lines = content.split("\n");
            documentLines.clear();
            lineVersionVectors.clear();
            lineOperationHistory.clear();
            for (int i = 0; i < lines.length; i++) {
                documentLines.add(lines[i]);
                lineVersionVectors.put(i, new VersionVector(new HashMap<>()));
                lineOperationHistory.put(i, new ArrayList<>());
            }
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
            documentLines.clear();
            documentLines.add("");
            lineVersionVectors.clear();
            lineVersionVectors.put(0, new VersionVector(new HashMap<>()));
            lineOperationHistory.clear();
            lineOperationHistory.put(0, new ArrayList<>());
            logger.info("OT service has been reset");
        } finally {
            lock.unlock();
        }
    }

    /**
     * Gets all operations in the history for a specific line
     */
    public List<TextOperation> getOperationHistory(int lineNumber) {
        lock.lock();
        try {
            int index = lineNumber - 1; // Convert to 0-based
            return new ArrayList<>(lineOperationHistory.getOrDefault(index, new ArrayList<>()));
        } finally {
            lock.unlock();
        }
    }

    /**
     * Get operations that happened after a given version vector for a specific line
     */
    public List<TextOperation> getOperationsSince(int lineNumber, VersionVector clientVector) {
        lock.lock();
        try {
            int index = lineNumber - 1;
            List<TextOperation> missingOps = new ArrayList<>();

            if (clientVector == null || clientVector.getVersions() == null) {
                return missingOps;
            }

            List<TextOperation> history = lineOperationHistory.getOrDefault(index, new ArrayList<>());
            for (TextOperation op : history) {
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
     * Calculate the document state at a specific version vector for all lines
     */
    public List<String> getDocumentAtVersion(Map<Integer, VersionVector> targetVectors) {
        lock.lock();
        try {
            List<String> tempDoc = new ArrayList<>();
            for (int i = 0; i < documentLines.size(); i++) {
                tempDoc.add("");
            }

            for (int lineIndex = 0; lineIndex < documentLines.size(); lineIndex++) {
                VersionVector targetVector = targetVectors.get(lineIndex);
                if (targetVector == null || targetVector.getVersions() == null) {
                    continue;
                }

                List<TextOperation> relevantOps = new ArrayList<>();
                List<TextOperation> history = lineOperationHistory.getOrDefault(lineIndex, new ArrayList<>());
                for (TextOperation op : history) {
                    if (isKnownByVector(op, targetVector)) {
                        relevantOps.add(op);
                    }
                }

                StringBuilder lineContent = new StringBuilder();
                for (TextOperation op : relevantOps) {
                    applyOperationTo(lineContent, op);
                }
                tempDoc.set(lineIndex, lineContent.toString());
            }

            return tempDoc;
        } finally {
            lock.unlock();
        }
    }

    private boolean isKnownByVector(TextOperation op, VersionVector vector) {
        String opUserId = op.getUserId();
        int opVersion = op.getBaseVersionVector().getVersions().getOrDefault(opUserId, 0) + 1;
        int vectorVersion = vector.getVersions().getOrDefault(opUserId, 0);
        return vectorVersion >= opVersion;
    }

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