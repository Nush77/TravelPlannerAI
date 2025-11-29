# TIPI Travel Assistant

An intelligent, user-friendly platform that helps travelers design better trips without the stress of searching through multiple online sources.

## Features

### 1. TIPI Questionnaire
A comprehensive 10-question form that collects detailed user preferences:
- Destination and travel duration
- Preferred experiences (food, culture, adventure, shopping, etc.)
- Dietary restrictions
- Transportation preferences
- Accommodation priorities
- Budget range
- Travel pacing style
- Activities to avoid
- Must-see attractions

### 2. Personalized Itinerary Generator
Automatically generates a complete, day-by-day, hour-by-hour itinerary based on user preferences:
- Real restaurant recommendations (matching dietary requirements)
- Hotel suggestions (matching budget and preferences)
- Actual attractions and hidden gems
- Time slots for each activity
- Estimated travel time between locations
- Google Maps links for directions
- Transportation recommendations
- Safe areas and neighborhoods

### 3. AI Travel Assistant Chatbot
Real-time travel Q&A powered by OpenAI:
- Answers questions about restaurants, safety, hidden spots
- Provides transportation guidance
- Offers cultural tips and current travel information
- Context-aware responses based on user's destination and preferences

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the root directory with:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   PORT=3000
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to `http://localhost:3000`

## Project Structure

```
TIPI Travel assistant/
├── server.js              # Express backend server
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables (create this)
├── .gitignore            # Git ignore file
├── public/               # Frontend files
│   ├── index.html        # Main HTML page
│   ├── styles.css        # Styling
│   └── app.js            # Frontend JavaScript
└── README.md             # This file
```

## API Endpoints

### POST `/api/generate-itinerary`
Generates a personalized itinerary based on user questionnaire answers.

**Request Body:**
```json
{
  "userId": "user_123",
  "destination": "New York City",
  "days": 5,
  "experiences": ["food", "culture"],
  "dietary": "vegetarian",
  "transportation": "public-transport",
  "accommodation": "mid-range",
  "budget": "moderate",
  "pacing": "moderate",
  "avoid": "crowded places",
  "mustSee": "Times Square"
}
```

### POST `/api/chat`
Sends a message to the AI travel assistant chatbot.

**Request Body:**
```json
{
  "message": "Where can I get vegetarian food near Times Square?",
  "userId": "user_123",
  "destination": "New York City"
}
```

## Usage

1. **Complete the Questionnaire:**
   - Fill out all 10 questions about your travel preferences
   - Click "Generate My Itinerary"

2. **Review Your Itinerary:**
   - View your personalized day-by-day plan
   - Check times, locations, and Google Maps links
   - Use "Start Over" to create a new itinerary

3. **Chat with AI Assistant:**
   - Click the chat icon in the bottom right
   - Ask questions about your destination
   - Get real-time travel advice

## Technologies Used

- **Backend:** Node.js, Express
- **AI:** OpenAI GPT-4 and GPT-3.5-turbo
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Styling:** Modern CSS with gradients and animations

## Notes

- The OpenAI API key is required for both itinerary generation and chatbot functionality
- Itineraries are generated using GPT-4 for detailed planning
- The chatbot uses GPT-3.5-turbo for faster, cost-effective responses
- All user profiles are stored in memory (use a database for production)

## Troubleshooting

- **"Failed to generate itinerary"**: Check your OpenAI API key and ensure you have API credits
- **Chatbot not responding**: Verify the API key and check server logs
- **Port already in use**: Change the PORT in `.env` file

## License

MIT

