# Slidexpress Project Tracker - Deployment Guide

This project is now ready to be deployed as a web app.

## Choice of Provider: Render.com (Recommended)
Since this app uses a local JSON database (files in the `data/` folder), **Render.com** is better than Vercel because Vercel does not allow saving files to its own disk.

### Step 1: Upload to GitHub
1. Create a new repository on GitHub.
2. Open your project folder in terminal.
3. Run:
   ```bash
   git init
   git add .
   git commit -m "Ready for deployment"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

### Step 2: Deploy on Render.com
1. Create a free account on [Render.com](https://render.com).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository.
4. Use these settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. **CRITICAL:** Go to the **Disk** section in Render settings:
   - Add a Disk (1GB is enough).
   - **Mount Path:** `/opt/render/project/src/data`
   - This ensures your database (users, files, projects) isn't deleted every time the app restarts.

### Step 3: Environment Variables (Optional but Recommended)
In Render, go to **Environment** and add:
- `JWT_SECRET`: A long random string (e.g., `your-secret-key-2026`).

---

## Why Render over Vercel?
Vercel is "Serverless," meaning it "forgets" any data saved in the `data/` folder every few minutes. **Render** with a "Disk" attached will keep your data forever, just like your local PC.
