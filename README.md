# limitlessAssistant

A powerful, uncensored AI chat interface built with React, Vite, Tailwind CSS, and Firebase.

## Features
- **Multiple Models**: Support for standard and uncensored AI models.
- **Custom Models**: Import any model from Hugging Face (simulated).
- **Glass Morphism UI**: A premium, high-definition interface with smooth animations.
- **Persistent History**: Chat history saved securely via Firebase Firestore.
- **Google Auth**: Secure login via Google.
- **Responsive Design**: Fully optimized for mobile, tablet, and desktop.

## Deployment to Render

To deploy this application to Render:

1. **Push to GitHub**: Upload your code to a GitHub repository.
2. **Create a Static Site**: On Render, create a new "Static Site" and connect your repository.
3. **Build Settings**:
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
4. **Environment Variables**:
   Add the following variables in the Render dashboard:
   - `GEMINI_API_KEY`: Your Google Gemini API Key.
   - `VITE_FIREBASE_API_KEY`: From your Firebase project settings.
   - `VITE_FIREBASE_AUTH_DOMAIN`: From your Firebase project settings.
   - `VITE_FIREBASE_PROJECT_ID`: From your Firebase project settings.
   - `VITE_FIREBASE_STORAGE_BUCKET`: From your Firebase project settings.
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`: From your Firebase project settings.
   - `VITE_FIREBASE_APP_ID`: From your Firebase project settings.
   - `VITE_FIREBASE_DATABASE_ID`: The ID of your Firestore database.

## Local Development

1. Clone the repository.
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example`.
4. Start the dev server: `npm run dev`
