/********************************************************************
   TIPI TRAVEL ASSISTANT — FINAL PRODUCTION VERSION (2025)
   THE MOST ACCURATE & REALISTIC ITINERARY ENGINE
********************************************************************/

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_KEY });

/*********************************************************
   DATA STORAGE
*********************************************************/
const userProfiles = {};
const userItineraries = {};
const usedPlaces = {}; // prevent duplicate places

/*********************************************************
   GOOGLE PLACE HELPERS
*********************************************************/
function photoUrl(place) {
  if (!place.photos?.length) return "";
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1400&photo_reference=${place.photos[0].photo_reference}&key=${GOOGLE_KEY}`;
}

async function fetchDetails(placeId) {
  try {
    const r = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: {
          place_id: placeId,
          fields:
            "name,formatted_address,geometry,photos,rating,user_ratings_total,website,international_phone_number,types",
          key: GOOGLE_KEY,
        },
      }
    );
    return r.data.result;
  } catch {
    return null;
  }
}

async function googleSearch(activity, profile, userId) {
  if (!GOOGLE_KEY) return null;

  if (!usedPlaces[userId]) usedPlaces[userId] = new Set();

  let query = "";

  // MEAL CATEGORIES
  if (activity.activityType === "breakfast") {
    query = `${profile.dietary} breakfast restaurants in ${profile.destination}`;
  } else if (activity.activityType === "lunch") {
    query = `${profile.dietary} lunch restaurants in ${profile.destination}`;
  } else if (activity.activityType === "dinner") {
    query = `${profile.dietary} dinner restaurants in ${profile.destination}`;
  } else {
    // GENERAL CATEGORIES
    query = `${activity.placeCategory} in ${profile.destination}`;
  }

  try {
    const r = await axios.get(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
      {
        params: { query, key: GOOGLE_KEY },
      }
    );

    const results = r.data?.results || [];
    if (!results.length) return null;

    // Filter unused places
    const filtered = results.filter((p) => !usedPlaces[userId].has(p.place_id));

    filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));

    const best = filtered[0];
    usedPlaces[userId].add(best.place_id);

    const details = await fetchDetails(best.place_id);

    return details || best;
  } catch {
    return null;
  }
}

function describe(place) {
  const name = place.name || "This location";
  const type = place.types?.[0]?.replace(/_/g, " ") || "place";
  const rating = place.rating ? `${place.rating}⭐` : "";

  return `${name} is a popular ${type} often praised by visitors ${rating}.`;
}

/*********************************************************
   TIMING FIXER
*********************************************************/
function assignTimes(itinerary) {
  const TIME_SLOTS = {
    breakfast: "8:00 AM",
    morning_1: "9:30 AM",
    morning_2: "11:00 AM",
    lunch: "12:30 PM",
    afternoon_1: "2:00 PM",
    afternoon_2: "3:30 PM",
    afternoon_3: "5:00 PM",
    dinner: "6:30 PM",
    night_1: "8:00 PM",
    night_2: "9:30 PM",
  };

  itinerary.days.forEach((day) => {
    let breakfastDone = false;
    let lunchDone = false;
    let dinnerDone = false;
    let morningAttractionCount = 0;
    let afternoonAttractionCount = 0;
    let nightActivityCount = 0;

    const cleaned = [];

    day.activities.forEach((act) => {
      let time = "";

      // ONE PER DAY RULE for meals
      if (act.activityType === "breakfast") {
        if (breakfastDone) return;
        time = TIME_SLOTS.breakfast;
        breakfastDone = true;
      } else if (act.activityType === "lunch") {
        if (lunchDone) return;
        time = TIME_SLOTS.lunch;
        lunchDone = true;
      } else if (act.activityType === "dinner") {
        if (dinnerDone) return;
        time = TIME_SLOTS.dinner;
        dinnerDone = true;
      } else if (act.activityType === "attraction") {
        // Multiple attractions - assign times sequentially
        if (!breakfastDone) {
          // Before breakfast - skip or assign early
          return;
        } else if (!lunchDone) {
          // Morning attractions (after breakfast, before lunch)
          if (morningAttractionCount === 0) {
            time = TIME_SLOTS.morning_1;
          } else {
            time = TIME_SLOTS.morning_2;
          }
          morningAttractionCount++;
        } else {
          // Afternoon attractions (after lunch)
          if (afternoonAttractionCount === 0) {
            time = TIME_SLOTS.afternoon_1;
          } else if (afternoonAttractionCount === 1) {
            time = TIME_SLOTS.afternoon_2;
          } else {
            time = TIME_SLOTS.afternoon_3;
          }
          afternoonAttractionCount++;
        }
      } else if (act.activityType === "night activity") {
        // Multiple night activities
        if (nightActivityCount === 0) {
          time = TIME_SLOTS.night_1;
        } else {
          time = TIME_SLOTS.night_2;
        }
        nightActivityCount++;
      }

      if (time) {
        act.time = time;
        cleaned.push(act);
      }
    });

    day.activities = cleaned;
  });

  return itinerary;
}

/*********************************************************
   ENRICHMENT
*********************************************************/
async function enrich(itinerary, profile, userId) {
  usedPlaces[userId] = new Set();

  for (const day of itinerary.days) {
    for (const act of day.activities) {
      const place = await googleSearch(act, profile, userId);
      if (!place) {
        // Even if no place found, map fields for frontend compatibility
        act.activity = act.placeCategory || act.activityType || "Activity";
        act.type =
          act.activityType === "breakfast" ||
          act.activityType === "lunch" ||
          act.activityType === "dinner"
            ? "restaurant"
            : act.activityType === "night activity"
            ? "attraction"
            : "attraction";
        continue;
      }

      // Map to frontend-expected fields
      act.activity = place.name || act.placeCategory || "Activity";
      act.name = place.name; // Keep for backward compatibility
      act.location = place.formatted_address || "";
      act.rating = place.rating || null;
      act.imageUrl = photoUrl(place);
      act.description = describe(place);
      act.googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        place.name + " " + act.location
      )}`;

      // Map activityType to type for frontend
      if (
        act.activityType === "breakfast" ||
        act.activityType === "lunch" ||
        act.activityType === "dinner"
      ) {
        act.type = "restaurant";
      } else if (act.activityType === "night activity") {
        act.type = "attraction";
      } else {
        act.type = "attraction";
      }
    }
  }

  return itinerary;
}

/*********************************************************
   ITINERARY GENERATOR PROMPT
*********************************************************/
function buildPrompt(profile) {
  const daysCount = parseInt(profile.days) || 1;

  return `
You are a world-class travel planner (like Google Trips + TripAdvisor combined).

🚨 CRITICAL: You MUST generate EXACTLY ${daysCount} complete days in the "days" array.
🚨 The "days" array MUST contain ${daysCount} day objects: day 1, day 2, day 3... up to day ${daysCount}.
🚨 If the user requests ${daysCount} days, you MUST create ${daysCount} separate day objects - NO EXCEPTIONS.

Your output MUST follow the JSON structure EXACTLY.

🚫 DO NOT create fake place names.  
Backend fills real places using Google Maps.  
You ONLY output categories.

STRICT RULES:

1. Each day must stay in ONE AREA / NEIGHBORHOOD:
   Example: "Midtown Manhattan", "Brooklyn Williamsburg", "Paris Left Bank"

2. Follow user preferences EXACTLY:
   Experiences: ${profile.experiences.join(", ")}
   ${
     profile.experiences && profile.experiences.includes("nightlife")
       ? "🚨 NIGHTLIFE IS SELECTED - YOU MUST INCLUDE 1-2 NIGHT ACTIVITIES PER DAY (bars, clubs, live music, rooftop venues, night markets, etc.)"
       : ""
   }
   Dietary: ${profile.dietary}
   Avoid: ${profile.avoid || "None"}
   Must-See: ${profile.mustSee || "None"}
   Pace: ${profile.pacing}
   Budget: ${profile.budget}
   Transportation: ${profile.transportation}

3. DAILY SCHEDULE STRUCTURE (for EACH of the ${daysCount} days) - GENERATE MANY ACTIVITIES:
   • Breakfast (1)
   • Morning Attractions (2-3 different attractions - museums, landmarks, parks, viewpoints, etc.)
   • Lunch (1)
   • Afternoon Attractions (2-3 different attractions - continue exploring, shopping, tours, etc.)
   • Dinner (1)
   • Night Activities (1-2 activities - ALWAYS include if user selected "nightlife", but also include evening entertainment like shows, bars, night markets, or scenic spots even if not explicitly selected)

   MINIMUM 8-10 activities per day (3 meals + 5-7 attractions/activities)

4. Activity types allowed:
   "breakfast", "lunch", "dinner", "attraction", "night activity"

5. You MUST use user interests to determine categories, for example:
   If user selected "culture": → "historical museum", "heritage landmark", "art gallery", "cultural center"
   If user selected "nightlife": → "rooftop bar", "music lounge", "nightclub", "live music venue", "cocktail bar"
   If user selected "adventure": → "hiking trail", "zipline park", "water sports", "adventure park"
   If user selected "shopping": → "shopping district", "premium mall", "local market", "boutique stores"
   If user selected "nature": → "national park", "botanical garden", "scenic viewpoint", "beach"
   If user selected "food": → "food market", "cooking class", "food tour", "local specialty restaurant"

6. VARY activities - never repeat the same type of attraction in the same day.
7. VARY the areas/neighborhoods across different days to show different parts of the destination.
8. ALWAYS include nightlife/evening activities - bars, night markets, shows, scenic night views, or entertainment venues.

8. DO NOT assign times. The backend assigns perfect times.

OUTPUT FORMAT (MANDATORY - MUST INCLUDE ALL ${daysCount} DAYS WITH 8-10 ACTIVITIES EACH):

{
  "days": [
    {
      "day": 1,
      "area": "Area name for Day 1",
      "activities": [
        {
          "activityType": "breakfast",
          "placeCategory": "vegan breakfast café",
          "notes": "Why this fits user"
        },
        {
          "activityType": "attraction",
          "placeCategory": "art museum",
          "notes": "Aligns with culture preference"
        },
        {
          "activityType": "attraction",
          "placeCategory": "historic landmark",
          "notes": "Must-see attraction"
        },
        {
          "activityType": "lunch",
          "placeCategory": "local restaurant",
          "notes": "Dietary match"
        },
        {
          "activityType": "attraction",
          "placeCategory": "scenic viewpoint",
          "notes": "Afternoon activity"
        },
        {
          "activityType": "attraction",
          "placeCategory": "shopping district",
          "notes": "Shopping preference"
        },
        {
          "activityType": "dinner",
          "placeCategory": "fine dining restaurant",
          "notes": "Budget appropriate"
        },
        {
          "activityType": "night activity",
          "placeCategory": "rooftop bar",
          "notes": "Nightlife experience"
        }
      ]
    },
    {
      "day": 2,
      "area": "Different area name for Day 2",
      "activities": [
        {
          "activityType": "breakfast",
          "placeCategory": "brunch spot",
          "notes": "Day 2 breakfast"
        },
        {
          "activityType": "attraction",
          "placeCategory": "national park",
          "notes": "Nature experience"
        },
        {
          "activityType": "attraction",
          "placeCategory": "botanical garden",
          "notes": "Day 2 morning activity"
        },
        {
          "activityType": "lunch",
          "placeCategory": "local cuisine restaurant",
          "notes": "Day 2 lunch"
        },
        {
          "activityType": "attraction",
          "placeCategory": "cultural center",
          "notes": "Day 2 afternoon"
        },
        {
          "activityType": "attraction",
          "placeCategory": "local market",
          "notes": "Shopping and culture"
        },
        {
          "activityType": "dinner",
          "placeCategory": "evening restaurant",
          "notes": "Day 2 dinner"
        },
        {
          "activityType": "night activity",
          "placeCategory": "live music venue",
          "notes": "Evening entertainment"
        }
      ]
    }${
      daysCount > 2
        ? `,
    ... continue for ALL ${daysCount} days with 8-10 activities each`
        : ""
    }
  ],
  "summary": "Short overview of the ${daysCount}-day trip"
}

🚨 REMEMBER: The "days" array MUST have exactly ${daysCount} objects. Count them: day 1, day 2${
    daysCount > 2 ? ", day 3" : ""
  }${daysCount > 3 ? ", ..." : ""} up to day ${daysCount}.

RETURN ONLY JSON. NO EXPLANATIONS. JUST THE JSON.
`;
}

/*********************************************************
   MAIN ENDPOINT — GENERATE ITINERARY
*********************************************************/
app.post("/api/generate-itinerary", async (req, res) => {
  try {
    const profile = req.body;
    const userId = profile.userId;
    const requestedDays = parseInt(profile.days) || 1;

    userProfiles[userId] = profile;

    const prompt = buildPrompt(profile);

    // Increase max_tokens for multi-day itineraries (roughly 3000 tokens per day for 8-10 activities)
    const maxTokens = Math.min(16000, 3000 + requestedDays * 3000);

    const gpt = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: maxTokens,
    });

    let json = gpt.choices[0].message.content.trim();
    json = json.replace(/```json|```/g, "");

    let itinerary = JSON.parse(json);

    // VALIDATION: Ensure all requested days are present
    if (!itinerary.days || !Array.isArray(itinerary.days)) {
      itinerary.days = [];
    }

    const actualDays = itinerary.days.length;

    if (actualDays < requestedDays) {
      console.warn(
        `⚠️ Only ${actualDays} days generated, but ${requestedDays} requested. Filling missing days...`
      );

      // Fill missing days with placeholder structure (8-10 activities)
      const hasNightlife =
        profile.experiences && profile.experiences.includes("nightlife");

      for (let dayNum = actualDays + 1; dayNum <= requestedDays; dayNum++) {
        const activities = [
          {
            activityType: "breakfast",
            placeCategory: `${profile.dietary} breakfast restaurant`,
            notes: "Day " + dayNum + " breakfast",
          },
          {
            activityType: "attraction",
            placeCategory: "popular tourist attraction",
            notes: "Day " + dayNum + " morning activity 1",
          },
          {
            activityType: "attraction",
            placeCategory: "historic landmark",
            notes: "Day " + dayNum + " morning activity 2",
          },
          {
            activityType: "lunch",
            placeCategory: `${profile.dietary} lunch restaurant`,
            notes: "Day " + dayNum + " lunch",
          },
          {
            activityType: "attraction",
            placeCategory: "cultural center",
            notes: "Day " + dayNum + " afternoon activity 1",
          },
          {
            activityType: "attraction",
            placeCategory: "scenic viewpoint",
            notes: "Day " + dayNum + " afternoon activity 2",
          },
          {
            activityType: "dinner",
            placeCategory: `${profile.dietary} dinner restaurant`,
            notes: "Day " + dayNum + " dinner",
          },
        ];

        // Add nightlife if selected or add evening activity anyway
        if (hasNightlife) {
          activities.push({
            activityType: "night activity",
            placeCategory: "rooftop bar",
            notes: "Day " + dayNum + " nightlife",
          });
        } else {
          activities.push({
            activityType: "night activity",
            placeCategory: "evening entertainment venue",
            notes: "Day " + dayNum + " evening activity",
          });
        }

        itinerary.days.push({
          day: dayNum,
          area: `${profile.destination} - Day ${dayNum} Area`,
          activities: activities,
        });
      }
    }

    // Ensure day numbers are correct
    itinerary.days.forEach((day, index) => {
      day.day = index + 1;
      if (!day.area) {
        day.area = `${profile.destination} - Day ${day.day}`;
      }
    });

    // Sort days by day number
    itinerary.days.sort((a, b) => (a.day || 0) - (b.day || 0));

    itinerary = assignTimes(itinerary);

    itinerary = await enrich(itinerary, profile, userId);

    // Final validation
    if (itinerary.days.length !== requestedDays) {
      console.error(
        `❌ Still missing days after enrichment. Expected ${requestedDays}, got ${itinerary.days.length}`
      );
    }

    userItineraries[userId] = itinerary;

    res.json({ success: true, itinerary });
  } catch (e) {
    console.error("ITINERARY ERROR:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/*********************************************************
   CHAT ENDPOINT
*********************************************************/
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId } = req.body;

    const profile = userProfiles[userId];
    const itinerary = userItineraries[userId];

    const prompt = `
You are a helpful travel assistant.

User profile:
${JSON.stringify(profile)}

Itinerary:
${JSON.stringify(itinerary).substring(0, 2500)}

Reply naturally and help with follow-up questions.
`;

    const gpt = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: message },
      ],
      max_tokens: 500,
    });

    res.json({ success: true, response: gpt.choices[0].message.content });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

/*********************************************************/
app.listen(PORT, () =>
  console.log(`TIPI Travel Assistant running on http://localhost:${PORT}`)
);