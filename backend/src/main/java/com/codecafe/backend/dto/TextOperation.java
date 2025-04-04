package com.codecafe.backend.dto;

import java.util.Objects;

public class TextOperation {
    private String id;
    private OperationType type;
    private int position;
    private String text;
    private Integer length;
    private VersionVector baseVersionVector;
    private String userId;
    private int lineNumber;

    public TextOperation() {
        // Default constructor
    }

    public int getLineNumber() {
        return lineNumber;
    }

    public void setLineNumber(int lineNumber) {
        this.lineNumber = lineNumber;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public OperationType getType() {
        return type;
    }

    public void setType(OperationType type) {
        this.type = type;
    }

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public Integer getLength() {
        return length;
    }

    public void setLength(Integer length) {
        this.length = length;
    }

    public VersionVector getBaseVersionVector() {
        return baseVersionVector;
    }

    public void setBaseVersionVector(VersionVector baseVersionVector) {
        this.baseVersionVector = baseVersionVector;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TextOperation that = (TextOperation) o;
        return position == that.position &&
                Objects.equals(id, that.id) &&
                type == that.type &&
                Objects.equals(text, that.text) &&
                Objects.equals(length, that.length) &&
                Objects.equals(baseVersionVector, that.baseVersionVector) &&
                Objects.equals(userId, that.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, type, position, text, length, baseVersionVector, userId);
    }

    @Override
    public String toString() {
        return "TextOperation{" +
                "id='" + id + '\'' +
                ", type=" + type +
                ", position=" + position +
                (text != null ? ", text='" + (text.length() > 20 ? text.substring(0, 17) + "..." : text) + '\'' : "") +
                (length != null ? ", length=" + length : "") +
                ", baseVersionVector=" + baseVersionVector +
                ", userId='" + userId + '\'' +
                '}';
    }
}