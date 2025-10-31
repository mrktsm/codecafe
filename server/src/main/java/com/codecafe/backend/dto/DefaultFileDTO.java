package com.codecafe.backend.dto;

/**
 * Simple DTO representing a default file served from the local repository.
 */
public class DefaultFileDTO {
    private String id;
    private String name;
    private String language;
    private String content;

    public DefaultFileDTO() {
        // Default constructor for Jackson
    }

    public DefaultFileDTO(String id, String name, String language, String content) {
        this.id = id;
        this.name = name;
        this.language = language;
        this.content = content;
    }

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

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }
}
