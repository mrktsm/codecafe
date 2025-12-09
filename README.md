## CodeCafé

![Build](https://img.shields.io/github/actions/workflow/status/mrktsm/codecafe/ci.yml?branch=main&label=build&logo=github)
![MIT License](https://img.shields.io/github/license/mrktsm/codecafe?label=license)
![GitHub stars](https://img.shields.io/github/stars/mrktsm/codecafe?logo=github)

A browser-based real-time code editor with multiuser collaboration powered by operational transformation (OT).

[Try CodeCafé Live](https://codecafe.app/)

![demo](https://github.com/user-attachments/assets/3f6875ac-58eb-4a57-8365-778e5a774304)

[Video overview: OT system and editor behavior](https://www.youtube.com/watch?v=NRYpmEbF7lk)

---

## Features

- **Live Preview:** Instantly renders HTML, CSS, and JavaScript.
- **Real-Time Collaboration:** Concurrent editing with OT-based conflict resolution.
- **Monaco Editor:** Syntax highlighting, autocomplete, and basic diagnostics.
- **Browser-Based:** No installation required.

---

## Tech Stack

- **Client:** React, TypeScript, Zustand, Tailwind CSS, Monaco Editor, Xterm.js, Framer Motion, Axios, WebSocket client  
- **Server:** Spring Boot, WebSocket API, Jackson  
- **Collaboration Layer:** Custom Operational Transformation implementation  
- **State / Messaging:** Redis (AWS ElastiCache) with Lua scripts for atomic operations  
- **Hosting:** AWS EC2 (server), Vercel (client), AWS ElastiCache (Redis)

---

## Operational Transformation

CodeCafé uses a custom OT implementation on both the client and server to keep all participants’ views of a document consistent.

OT enables:

- Adjusting operations (insert/delete) when concurrent changes occur  
- Ensuring all clients converge to the same document state  
- Preserving each user’s intended edits  

The system handles:

- Concurrent edits from multiple users  
- Deterministic conflict resolution  
- Consistent document state across sessions  

---

## CI/CD Pipeline

The project includes a GitHub Actions pipeline with:

- **Continuous Integration:** Tests for client and server on each PR and push  
- **Continuous Deployment:** Automatic deployment to EC2 (server) and Vercel (client) on merges to `main`  
- **Quality Checks:** Basic safeguards against regressions before deployment  

---

## Quick Start

Run CodeCafé locally using Docker:

```bash
git clone https://github.com/mrktsm/codecafe.git
cd codecafe
docker-compose up
```

Access the app at http://localhost:80

For more detailed setup and development guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- User authentication & persistent projects
- Integrated voice/text chat
- Session rewind & history playback
- Expanded language support & tooling

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT License](https://opensource.org/licenses/MIT)
