package com.codecafe.backend.controller;

import com.codecafe.backend.dto.TextOperation;
import com.codecafe.backend.dto.OperationAck;
import com.codecafe.backend.dto.VersionVector;
import com.codecafe.backend.service.OtService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

@Controller
public class OtController {

    @Autowired
    private OtService otService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/operation")
    public void handleOperation(TextOperation operation) {
        TextOperation transformedOp = otService.processOperation(operation);
        messagingTemplate.convertAndSend("/topic/operations", transformedOp);

        OperationAck ack = new OperationAck();
        ack.setOperationId(transformedOp.getId());
        ack.setLineNumber(transformedOp.getLineNumber());
        ack.setVersionVector(transformedOp.getBaseVersionVector());
        ack.setUserId(transformedOp.getUserId());
        messagingTemplate.convertAndSend("/topic/operation-ack", ack);
    }

    @MessageMapping("/get-document-state")
    public void getDocumentState(Map<String, Object> request) {
        String userId = (String) request.get("userId");
        Map<Integer, Map<String, Integer>> clientVersionVector = (Map<Integer, Map<String, Integer>>) request.get("clientVersionVector");
        Map<Integer, VersionVector> versionVectors = new HashMap<>();
        if (clientVersionVector != null) {
            clientVersionVector.forEach((k, v) -> versionVectors.put(k, new VersionVector(v)));
        }

        Map<String, Object> response = new HashMap<>();
        response.put("content", otService.getDocumentContent());
        response.put("versionVector", otService.getLineVersionVectors());
        response.put("missingOperations", new ArrayList<>());
        messagingTemplate.convertAndSendToUser(userId, "/queue/document-state", response);
    }
}