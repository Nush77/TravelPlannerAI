# Quick Setup Guide

## Step 1: Install Dependencies
```bash
npm install
```

## Step 2: Create .env File
Create a file named `.env` in the root directory with the following content:

```
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_API_KEY=your_google_maps_places_api_key_here
PORT=3000
```

**Note:** Never commit real API keys to GitHub. Keep them only in your local `.env` file.

## Step 3: Start the Server
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

## Step 4: Open in Browser
Navigate to: `http://localhost:3000`

## Troubleshooting

- **Port 3000 already in use?** Change the PORT in your .env file
- **Module not found errors?** Run `npm install` again
- **API errors?** Check that your OpenAI API key is valid and you have credits

