package com.codecafe.backend.dto;

public class CursorMessage {
    private UserInfo user;

    public CursorMessage() {} // default constructor

    public UserInfo getUser() {
        return user;
    }

    public void setUser(UserInfo user) {
        this.user = user;
    }

    public static class UserInfo {
        private String id;
        private String name;
        private String color;
        private Cursor cursor;

        public UserInfo() {} // default constructor

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getColor() {
            return color;
        }

        public void setColor(String color) {
            this.color = color;
        }

        public Cursor getCursor() {
            return cursor;
        }

        public void setCursor(Cursor cursor) {
            this.cursor = cursor;
        }

        public static class Cursor {
            private Position cursorPosition;
            private Selection selection;

            public Cursor() {} // default constructor

            public Position getCursorPosition() {
                return cursorPosition;
            }

            public void setCursorPosition(Position cursorPosition) {
                this.cursorPosition = cursorPosition;
            }

            public Selection getSelection() {
                return selection;
            }

            public void setSelection(Selection selection) {
                this.selection = selection;
            }
        }
    }

    public static class Position {
        private int lineNumber;
        private int column;

        public Position() {} // default constructor

        public int getLineNumber() {
            return lineNumber;
        }

        public void setLineNumber(int lineNumber) {
            this.lineNumber = lineNumber;
        }

        public int getColumn() {
            return column;
        }

        public void setColumn(int column) {
            this.column = column;
        }
    }

    public static class Selection {
        private int startLineNumber;
        private int startColumn;
        private int endLineNumber;
        private int endColumn;

        public Selection() {} // default constructor

        public int getStartLineNumber() {
            return startLineNumber;
        }

        public void setStartLineNumber(int startLineNumber) {
            this.startLineNumber = startLineNumber;
        }

        public int getStartColumn() {
            return startColumn;
        }

        public void setStartColumn(int startColumn) {
            this.startColumn = startColumn;
        }

        public int getEndLineNumber() {
            return endLineNumber;
        }

        public void setEndLineNumber(int endLineNumber) {
            this.endLineNumber = endLineNumber;
        }

        public int getEndColumn() {
            return endColumn;
        }

        public void setEndColumn(int endColumn) {
            this.endColumn = endColumn;
        }
    }
}