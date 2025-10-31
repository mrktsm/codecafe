## CodeCafé

![Build](https://img.shields.io/github/actions/workflow/status/mrktsm/codecafe/ci.yml?branch=main&label=build&logo=github)
![MIT License](https://img.shields.io/github/license/mrktsm/codecafe?label=license)
![GitHub stars](https://img.shields.io/github/stars/mrktsm/codecafe?logo=github)

A real-time collaborative code editor that runs in your browser. Multiple users can edit the same files simultaneously with conflict resolution powered by operational transformation.

[Try CodeCafé Live!](https://codecafe.app/)

<!--
![image](https://github.com/user-attachments/assets/68590a84-a055-4876-8c66-8f446f83c038)
![Untitled design (12)](https://github.com/user-attachments/assets/4f1ed970-97d9-430c-89ba-a91f1ec17be4)
-->

![Untitled design (14)](https://github.com/user-attachments/assets/3f6875ac-58eb-4a57-8365-778e5a774304)

[Click here to see CodeCafé in action and learn how its OT works under the hood!](https://www.youtube.com/watch?v=NRYpmEbF7lk)

## Features

- **Live Preview:** HTML, CSS, and JavaScript changes render instantly in an integrated web view
- **Real-Time Collaboration:** Multiple users can edit the same files simultaneously using operational transformation for conflict resolution
- **Monaco Editor:** Full-featured code editor with syntax highlighting, autocomplete, and error checking
- **Browser-Based:** No installation required - everything runs in your browser

## Tech Stack

- **Client:** React, TypeScript, Zustand (State Management), Tailwind CSS, Monaco Editor, Xterm.js (Integrated Terminal), Framer Motion, Axios, WebSocket Client
- **Server:** Java Spring Boot, WebSocket API, Jackson (JSON Processing)
- **Real-time Collaboration:** Custom Operational Transformation (OT) Implementation
- **State Management / Messaging:** Redis (AWS ElastiCache) utilizing Lua Scripting for atomic operations
- **Hosting**: AWS EC2 (Server), Vercel (Client), AWS ElastiCache (Redis)

## Real-Time Collaboration with Operational Transformation

At the heart of CodeCafé's seamless collaborative editing is our custom-built Operational Transformation (OT) system, implemented on both the client and server.

### What is Operational Transformation?

Operational Transformation is the technology that powers real-time collaborative editing in systems like Google Docs. It allows multiple users to simultaneously edit the same document by:

1. Transforming operations (like insertions and deletions) to preserve user intentions
2. Ensuring eventual consistency across all clients
3. Resolving conflicts automatically when users edit the same regions of text

Our implementation handles the complex synchronization challenges of collaborative editing, including:

- Managing concurrent edits from multiple users
- Resolving edit conflicts deterministically
- Maintaining document consistency across all connected clients
- Preserving intention semantics of user operations

This enables truly fluid, Google Docs-like collaboration where everyone can type simultaneously without stepping on each other's toes.

## CI/CD Pipeline

CodeCafé features a fully automated CI/CD pipeline built with GitHub Actions:

- **Continuous Integration:** Automated testing for both client and server on every pull request and push
- **Continuous Deployment:** Automatic deployment to production (AWS EC2 + Vercel) when changes are merged to main
- **Quality Assurance:** Ensures code quality and prevents regressions before deployment

This enables rapid, reliable development cycles while maintaining production stability.

## Quick Start

Want to try CodeCafé locally? The easiest way is with Docker:

```bash
git clone https://github.com/mrktsm/codecafe.git
cd codecafe
docker-compose up
```

Access the app at http://localhost:80

By default the backend mounts `./default-files` and exposes its contents through the editor. If you want to serve a different local project, edit the `server` volume mapping in `docker-compose.yml` (replace `./default-files` with your desired path) before running `docker-compose up`.

For detailed setup instructions, development guidelines, and contribution information, see [CONTRIBUTING.md](CONTRIBUTING.md).

## On the Horizon

- User authentication & persistent projects
- Integrated voice/text chat
- Session rewind & history playback
- Expanded language support & tooling

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, guidelines, and how to get started.

## License

CodeCafé is open-sourced under the [MIT License](https://opensource.org/licenses/MIT).
