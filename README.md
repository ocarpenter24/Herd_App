# Herd — trail cam tracker

React PWA over the Supabase database that reveal_sync.py fills.

## Setup
1. Supabase SQL Editor: run setup_app.sql
2. Supabase -> Authentication -> Users -> Add user:
   your email + the passcode you want (this IS the app passcode)
3. Push this folder to a GitHub repo
4. vercel.com -> Add New Project -> import the repo (framework: Vite)
5. Vercel project -> Settings -> Environment Variables:
   VITE_SUPABASE_URL      = your project URL
   VITE_SUPABASE_ANON_KEY = the sb_publishable_... key
   VITE_LOGIN_EMAIL       = the email from step 2
6. Deploy. Open the URL on your iPhone in Safari -> Share -> Add to Home Screen
