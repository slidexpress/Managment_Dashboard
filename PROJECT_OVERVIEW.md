# Slidexpress Project Management Dashboard - Overview

This document provides a complete overview of how this project works, the technologies used, and how data is managed.

## 1. Core Purpose
This is a professional project management tool designed for teams to track files, manage projects, and communicate in real-time. It handles user authentication, file status tracking, and team-wide notifications.

## 2. Technology Stack
*   **Backend:** Node.js with Express.
    *   *Why?* Fast, scalable, and perfect for handling many simultaneous connections.
*   **Frontend:** Vanilla JavaScript (ES6+), HTML5, and CSS3.
    *   *Why?* Lightweight and fast. No heavy frameworks (like React) makes it easy to maintain and deploy.
*   **Real-Time:** Socket.io.
    *   *Why?* Powers the live chat, instant notifications, and real-time dashboard updates without needing to refresh the page.
*   **Authentication:** JWT (JSON Web Tokens) and Bcrypt.js.
    *   *Why?* Securely handles user logins and password hashing.

## 3. Data Storage (The "Database")
Instead of a complex SQL database, this project uses **JSON files** stored in the `data/` folder. This makes the project portable and easy to set up.

### What is saved in the text (JSON) files?
1.  **users.json:** Stores user profiles (Name, Email, Hashed Password, Role, Team).
2.  **projects.json:** Stores project details (Client name, deadlines, status).
3.  **files.json:** Stores individual file tasks within projects (File name, assigned user, current status).
4.  **messages.json:** Stores all chat history for the team.
5.  **notifications.json:** Stores alerts for users (e.g., "Your file was approved").
6.  **signup_requests.json:** Stores pending account requests from new users.

## 4. Key Features
*   **Dashboard:** Real-time statistics on file progress and project health.
*   **File Tracking:** Move files through stages: `Pending` -> `In Progress` -> `Review` -> `Completed`.
*   **Live Chat:** A "General" room for team communication.
*   **Access Requests:** An admin approval system for new users.
*   **Role-Based Access:** Admins and Leads have more control than regular Team members.

## 5. Deployment Recommendation
The project is best hosted on **Render.com** because it natively supports:
1.  **Persistent WebSockets:** Required for the chat and live updates.
2.  **File System Access:** Required for reading/writing the JSON data files.

---
*Created on: May 2026*
