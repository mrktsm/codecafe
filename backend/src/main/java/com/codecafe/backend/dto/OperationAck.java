package com.codecafe.backend.dto;

public class OperationAck {
    private String operationId;
    private VersionVector versionVector;
    private String userId;
    private int lineNumber;

    public OperationAck() {
    }

    public int getLineNumber() {
        return lineNumber;
    }

    public void setLineNumber(int lineNumber) {
        this.lineNumber = lineNumber;
    }

    public OperationAck(String operationId, VersionVector versionVector, String userId) {
        this.operationId = operationId;
        this.versionVector = versionVector;
        this.userId = userId;
    }

    public String getOperationId() {
        return operationId;
    }

    public void setOperationId(String operationId) {
        this.operationId = operationId;
    }

    public VersionVector getVersionVector() {
        return versionVector;
    }

    public void setVersionVector(VersionVector versionVector) {
        this.versionVector = versionVector;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }
}