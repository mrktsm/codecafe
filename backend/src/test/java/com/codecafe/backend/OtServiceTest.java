package com.codecafe.backend;

import com.codecafe.backend.dto.OperationType;
import com.codecafe.backend.dto.TextOperation;
import com.codecafe.backend.dto.VersionVector;
import com.codecafe.backend.service.OtService; // Assuming this is the correct package
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*; // Ensure static import

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Logger; // Import Logger

class OtServiceTest {

    private OtService otService;
    private final String USER_A = "userA"; // Behind
    private final String USER_B = "userB"; // Ahead
    private static final Logger logger = Logger.getLogger(OtServiceTest.class.getName()); // Optional: if you want logging in test output

    @BeforeEach
    void setUp() {
        otService = new OtService();
        otService.reset(); // Ensure clean state
    }

    // --- Helper Methods (assuming they exist as provided before) ---
    private VersionVector createVector(Map<String, Integer> versions) {
        return new VersionVector(new HashMap<>(versions));
    }
    private TextOperation createOp(String userId, OperationType type, int position,
                                   String text, Integer length, VersionVector baseVector) {
        TextOperation op = new TextOperation();
        op.setId(UUID.randomUUID().toString());
        op.setUserId(userId);
        op.setType(type);
        op.setPosition(position);
        op.setText(text);
        op.setLength(length);
        op.setBaseVersionVector(baseVector != null ? baseVector : createVector(new HashMap<>()));
        return op;
    }

    // --- Test for the specific cursor jump scenario ---

    @Test
    @DisplayName("Backend Transform: User Ahead's Op Position After User Behind's Op Processed")
    void testTransformOperation_UserAhead_After_UserBehind() {
        logger.info("Starting test: testTransformOperation_UserAhead_After_UserBehind");
        otService.setDocumentContent("abcde");
        assertEquals("abcde", otService.getDocumentContent(), "Initial document content incorrect");

        // Define the base state vector from which both operations originate
        VersionVector initialStateVector = createVector(new HashMap<>());

        // 1. Process User A's operation (inserting "X" at position 1 - "behind")
        logger.info("Step 1: Processing User A's operation (Insert 'X' @ 1)");
        TextOperation opA = createOp(USER_A, OperationType.INSERT, 1, "X", null, initialStateVector);
        TextOperation resultA = otService.processOperation(opA);

        // Verify intermediate state after OpA
        assertEquals("aXbcde", otService.getDocumentContent(), "Document content after OpA is wrong");
        assertEquals(1, otService.getServerVersionVector().getVersions().get(USER_A), "Server version for User A after OpA");
        assertNull(otService.getServerVersionVector().getVersions().get(USER_B), "Server version for User B after OpA should be null");
        assertEquals(1, otService.getOperationHistory().size(), "History size after OpA");
        // Check the vector stored with the history operation (server state AFTER opA)
        assertEquals(1, otService.getOperationHistory().get(0).getBaseVersionVector().getVersions().get(USER_A), "History OpA's vector state for User A");


        // 2. Process User B's operation (inserting "Y" at position 3 - "ahead", concurrent to OpA)
        logger.info("Step 2: Processing User B's operation (Insert 'Y' @ 3 - concurrent to OpA)");
        TextOperation opB = createOp(USER_B, OperationType.INSERT, 3, "Y", null, initialStateVector); // *** Uses initial state vector ***
        // This call triggers findConcurrentOperations (should find OpA') and transformOperation(opB, resultA)
        TextOperation resultB = otService.processOperation(opB);

        // 3. Assertions - Verify final state and the critical transformed position of OpB

        // Verify final document state
        // Expected: OpB(pos=3) transforms against OpA'(pos=1, len=1). New pos = 3 + 1 = 4.
        // Apply Insert("Y", 4) to "aXbcde" -> "aXbcYde"
        assertEquals("aXbcYde", otService.getDocumentContent(), "Final document content is wrong");

        // Verify final server version vector
        assertEquals(1, otService.getServerVersionVector().getVersions().get(USER_A), "Final server version for User A");
        assertEquals(1, otService.getServerVersionVector().getVersions().get(USER_B), "Final server version for User B");
        assertEquals(2, otService.getOperationHistory().size(), "Final history size");

        // ***** CRUCIAL ASSERTION *****
        // Check the position of the operation returned/broadcasted for User B.
        // It MUST reflect the position *after* transformation against User A's op.
        assertNotNull(resultB, "Result of processing OpB should not be null");
        assertEquals(4, resultB.getPosition(), "Position of User B's transformed operation is incorrect! This likely causes the cursor jump.");

        // Optional: Verify the returned operation's vector reflects the final state
        assertEquals(1, resultB.getBaseVersionVector().getVersions().get(USER_A), "Returned OpB's vector state for User A");
        assertEquals(1, resultB.getBaseVersionVector().getVersions().get(USER_B), "Returned OpB's vector state for User B");

        logger.info("Finished test: testTransformOperation_UserAhead_After_UserBehind - Passed (if no assertion errors)");
    }

    @Test
    @DisplayName("Backend Transform: User Behind's Op Position After User Ahead's Op Processed")
    void testTransformOperation_UserBehind_After_UserAhead() {
        logger.info("Starting test: testTransformOperation_UserBehind_After_UserAhead");
        otService.setDocumentContent("abcde");
        assertEquals("abcde", otService.getDocumentContent(), "Initial document content incorrect");

        VersionVector initialStateVector = createVector(new HashMap<>());

        // 1. Process User B's operation (inserting "Y" at position 3 - "ahead")
        logger.info("Step 1: Processing User B's operation (Insert 'Y' @ 3)");
        TextOperation opB = createOp(USER_B, OperationType.INSERT, 3, "Y", null, initialStateVector);
        TextOperation resultB = otService.processOperation(opB);

        assertEquals("abcYde", otService.getDocumentContent(), "Document content after OpB is wrong");
        assertEquals(1, otService.getServerVersionVector().getVersions().get(USER_B), "Server version for User B after OpB");
        assertNull(otService.getServerVersionVector().getVersions().get(USER_A), "Server version for User A after OpB should be null");

        // 2. Process User A's operation (inserting "X" at position 1 - "behind", concurrent to OpB)
        logger.info("Step 2: Processing User A's operation (Insert 'X' @ 1 - concurrent to OpB)");
        TextOperation opA = createOp(USER_A, OperationType.INSERT, 1, "X", null, initialStateVector);
        TextOperation resultA = otService.processOperation(opA); // Should transform against resultB

        // 3. Assertions

        // Verify final document state
        // Expected: OpA(pos=1) transforms against OpB'(pos=3, len=1). Since 1 < 3, pos remains 1.
        // Apply Insert("X", 1) to "abcYde" -> "aXbcYde"
        assertEquals("aXbcYde", otService.getDocumentContent(), "Final document content is wrong");

        // Verify final server version vector
        assertEquals(1, otService.getServerVersionVector().getVersions().get(USER_A), "Final server version for User A");
        assertEquals(1, otService.getServerVersionVector().getVersions().get(USER_B), "Final server version for User B");

        // ***** CRUCIAL ASSERTION *****
        // Check the position of the operation returned/broadcasted for User A.
        // It should be unchanged by the transformation against User B's op.
        assertNotNull(resultA, "Result of processing OpA should not be null");
        assertEquals(1, resultA.getPosition(), "Position of User A's transformed operation is incorrect!");

        logger.info("Finished test: testTransformOperation_UserBehind_After_UserAhead - Passed (if no assertion errors)");
    }
}