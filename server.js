const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
// IMPORTANT: Never hardcode real API keys in this file.
// Keep your real keys ONLY in the local .env file (which is gitignored),
// and use obvious placeholders here so the code is safe to push to GitHub.
const GOOGLE_API_KEY =
  process.env.GOOGLE_API_KEY || "YOUR_GOOGLE_MAPS_PLACES_API_KEY_HERE";
const OPENAI_API_KEY_FALLBACK =
  process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY_HERE";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || OPENAI_API_KEY_FALLBACK,
});

// Store for user profiles and itineraries (in production, use a database)
const userProfiles = {};
const userItineraries = {};
const usedPlaces = {}; // Track used places to prevent repetition

// Convert 24-hour time to 12-hour format
function convertTo12Hour(time24) {
  if (!time24 || typeof time24 !== "string") return time24;

  // Handle formats like "09:00", "14:30", etc.
  const match = time24.match(/(\d{1,2}):(\d{2})/);
  if (!match) return time24;

  let hours = parseInt(match[1]);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";

  if (hours === 0) {
    hours = 12;
  } else if (hours > 12) {
    hours = hours - 12;
  }

  return `${hours}:${minutes} ${period}`;
}

// Parse time string to minutes for sorting (handles both 12-hour and 24-hour formats)
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;

  // Handle 12-hour format (e.g., "9:00 AM", "2:30 PM")
  const match12 = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match12) {
    let hours = parseInt(match12[1]);
    const minutes = parseInt(match12[2]);
    const period = match12[3].toUpperCase();

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
  }

  // Handle 24-hour format (e.g., "09:00", "14:30")
  const match24 = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (match24) {
    const hours = parseInt(match24[1]);
    const minutes = parseInt(match24[2]);
    return hours * 60 + minutes;
  }

  return 0;
}

// Validate and fix time to be within 8 AM - 10 PM range
function validateAndFixTime(timeStr, activityIndex) {
  if (!timeStr) {
    // Default times based on index: 8 AM, 11 AM, 2 PM, 5 PM, 8 PM
    const defaultTimes = [
      "8:00 AM",
      "11:00 AM",
      "2:00 PM",
      "5:00 PM",
      "8:00 PM",
    ];
    return defaultTimes[activityIndex % defaultTimes.length];
  }

  const minutes = parseTimeToMinutes(timeStr);
  const minMinutes = 8 * 60; // 8:00 AM
  const maxMinutes = 22 * 60; // 10:00 PM

  // If time is before 8 AM, set to 8 AM
  if (minutes < minMinutes) {
    return "8:00 AM";
  }

  // If time is after 10 PM, set to 10:00 PM
  if (minutes > maxMinutes) {
    return "10:00 PM";
  }

  // Ensure time is in 12-hour format
  return convertTo12Hour(timeStr);
}

// --------- Helper functions for Google Places / Maps ----------

function buildGoogleMapsLinkFromPlace(place) {
  if (!place) return "";
  const name = encodeURIComponent(place.name || "");
  const address = place.formatted_address
    ? encodeURIComponent(place.formatted_address)
    : "";

  // Use place_id for more accurate directions if available
  if (place.place_id) {
    return `https://www.google.com/maps/place/?q=place_id:${place.place_id}`;
  }

  // Fallback to search with name and address
  const query = address ? `${name}, ${address}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query
  )}`;
}

function buildPhotoUrlFromPlace(place, maxWidth = 800) {
  if (!place || !place.photos || !place.photos.length || !GOOGLE_API_KEY)
    return "";
  const ref = place.photos[0].photo_reference;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${encodeURIComponent(
    ref
  )}&key=${GOOGLE_API_KEY}`;
}

// Get detailed place information including photos
async function getPlaceDetails(placeId) {
  if (!GOOGLE_API_KEY || !placeId) return null;

  try {
    const url = "https://maps.googleapis.com/maps/api/place/details/json";
    const response = await axios.get(url, {
      params: {
        place_id: placeId,
        fields:
          "name,formatted_address,geometry,photos,rating,price_level,opening_hours,website,international_phone_number,types",
        key: GOOGLE_API_KEY,
      },
    });

    if (response.data && response.data.result) {
      return response.data.result;
    }
  } catch (err) {
    const errorData = err.response?.data || {};
    const errorStatus = err.response?.status;

    if (errorStatus === 403) {
      console.error(
        "❌ Google Place Details API Error: API key is invalid or Places API is not enabled"
      );
    } else if (errorStatus === 400) {
      console.error(
        "❌ Google Place Details API Error: Invalid request",
        errorData
      );
    } else {
      console.error(
        "❌ Google Place Details API Error:",
        errorData.error_message || errorData.status || err.message
      );
    }
  }

  return null;
}

// Calculate travel time between two locations
async function calculateTravelTime(origin, destination, mode = "walking") {
  if (!GOOGLE_API_KEY || !origin || !destination) return null;

  try {
    const url = "https://maps.googleapis.com/maps/api/directions/json";
    const response = await axios.get(url, {
      params: {
        origin:
          typeof origin === "string" ? origin : `${origin.lat},${origin.lng}`,
        destination:
          typeof destination === "string"
            ? destination
            : `${destination.lat},${destination.lng}`,
        mode:
          mode === "public-transport"
            ? "transit"
            : mode === "rideshare"
            ? "driving"
            : mode,
        key: GOOGLE_API_KEY,
      },
    });

    if (
      response.data &&
      response.data.routes &&
      response.data.routes.length > 0
    ) {
      const route = response.data.routes[0];
      if (route.legs && route.legs.length > 0) {
        const leg = route.legs[0];
        return {
          duration: leg.duration.text,
          durationSeconds: leg.duration.value,
          distance: leg.distance.text,
          distanceMeters: leg.distance.value,
        };
      }
    }
  } catch (err) {
    const errorData = err.response?.data || {};
    const errorStatus = err.response?.status;

    if (errorStatus === 403) {
      console.error(
        "❌ Google Directions API Error: API key is invalid or Directions API is not enabled"
      );
    } else {
      console.error(
        "❌ Google Directions API Error:",
        errorData.error_message || errorData.status || err.message
      );
    }
  }

  return null;
}

async function searchPlaceForActivity(activity, profile, userId = "default") {
  if (!GOOGLE_API_KEY) {
    return null;
  }

  // Initialize used places tracking for this user
  if (!usedPlaces[userId]) {
    usedPlaces[userId] = new Set();
  }

  let queryParts = [];
  let placeType = null;

  if (activity.activity && activity.activity !== "Activity name") {
    queryParts.push(activity.activity);
  }

  if (activity.type === "restaurant") {
    queryParts.push("restaurant");
    placeType = "restaurant";
    if (profile.dietary && profile.dietary !== "none") {
      queryParts.push(profile.dietary);
    }
  } else if (activity.type === "hotel") {
    queryParts.push("hotel");
    placeType = "lodging";
  } else if (activity.type === "attraction") {
    queryParts.push("tourist attraction");
    placeType = "tourist_attraction";
  }

  if (profile.destination) {
    queryParts.push(profile.destination);
  }

  const query = queryParts.join(" ").trim();
  if (!query) return null;

  const url = "https://maps.googleapis.com/maps/api/place/textsearch/json";

  try {
    const response = await axios.get(url, {
      params: {
        query,
        key: GOOGLE_API_KEY,
        type: placeType || undefined,
      },
    });

    if (
      response.data &&
      Array.isArray(response.data.results) &&
      response.data.results.length > 0
    ) {
      // Sort by rating (highest first) and user_ratings_total (most popular)
      const sortedResults = response.data.results
        .filter((place) => {
          // Skip if already used
          if (place.place_id && usedPlaces[userId].has(place.place_id)) {
            return false;
          }
          // Prioritize places with ratings (more popular)
          return place.rating && place.rating >= 3.5;
        })
        .sort((a, b) => {
          // Sort by rating first, then by number of reviews
          const ratingDiff = (b.rating || 0) - (a.rating || 0);
          if (ratingDiff !== 0) return ratingDiff;
          return (b.user_ratings_total || 0) - (a.user_ratings_total || 0);
        });

      // Get the best available place
      const place = sortedResults[0] || response.data.results[0];

      // Mark as used
      if (place.place_id) {
        usedPlaces[userId].add(place.place_id);
      }

      // Always get place details to ensure we have photos
      if (place.place_id) {
        const details = await getPlaceDetails(place.place_id);
        if (details) {
          // Merge details, prioritizing photos from details API
          return {
            ...place,
            ...details,
            photos: details.photos || place.photos || [],
          };
        }
      }

      return place;
    }
  } catch (err) {
    const errorData = err.response?.data || {};
    const errorStatus = err.response?.status;

    if (errorStatus === 403) {
      console.error(
        "❌ Google Places API Error: API key is invalid or billing is not enabled"
      );
      console.error(
        "   Please check: https://console.cloud.google.com/apis/credentials"
      );
    } else if (errorStatus === 400) {
      console.error("❌ Google Places API Error: Invalid request", errorData);
    } else {
      console.error(
        "❌ Google Places API Error:",
        errorData.error_message || errorData.status || err.message
      );
    }
  }

  return null;
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

async function enrichItineraryWithPlaces(
  itinerary,
  profile,
  userId = "default"
) {
  if (!GOOGLE_API_KEY || !itinerary || !Array.isArray(itinerary.days)) {
    return itinerary;
  }

  // Reset used places for new itinerary
  usedPlaces[userId] = new Set();

  // Process all days and activities
  for (const day of itinerary.days) {
    if (!day.activities || !Array.isArray(day.activities)) continue;

    // First pass: get all places with coordinates
    const activitiesWithPlaces = [];
    for (let i = 0; i < day.activities.length; i++) {
      const activity = day.activities[i];

      if (
        activity.type === "break" ||
        !activity.type ||
        !["restaurant", "hotel", "attraction"].includes(activity.type)
      ) {
        activitiesWithPlaces.push({ activity, place: null, index: i });
        continue;
      }

      // Search for the place
      const place = await searchPlaceForActivity(activity, profile, userId);
      activitiesWithPlaces.push({ activity, place, index: i });

      // Reduced delay - only 50ms between requests for faster processing
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Second pass: reorder activities to group nearby places together
    const activitiesWithCoords = activitiesWithPlaces
      .filter(
        (item) =>
          item.place && item.place.geometry && item.place.geometry.location
      )
      .map((item) => ({
        ...item,
        lat: item.place.geometry.location.lat,
        lng: item.place.geometry.location.lng,
      }));

    // Sort activities by proximity (simple nearest neighbor)
    if (activitiesWithCoords.length > 1) {
      const sorted = [activitiesWithCoords[0]];
      const remaining = activitiesWithCoords.slice(1);

      while (remaining.length > 0) {
        const last = sorted[sorted.length - 1];
        let nearest = remaining[0];
        let minDist = calculateDistance(
          last.lat,
          last.lng,
          nearest.lat,
          nearest.lng
        );

        for (let i = 1; i < remaining.length; i++) {
          const dist = calculateDistance(
            last.lat,
            last.lng,
            remaining[i].lat,
            remaining[i].lng
          );
          if (dist < minDist) {
            minDist = dist;
            nearest = remaining[i];
          }
        }

        sorted.push(nearest);
        remaining.splice(remaining.indexOf(nearest), 1);
      }

      // Reorder day.activities based on sorted order
      const newOrder = [];
      const sortedIndices = new Set(sorted.map((s) => s.index));

      // Add sorted activities first
      sorted.forEach((s) => {
        newOrder.push(day.activities[s.index]);
      });

      // Add remaining activities (breaks, etc.) in original order
      day.activities.forEach((act, idx) => {
        if (!sortedIndices.has(idx)) {
          newOrder.push(act);
        }
      });

      day.activities = newOrder;
    }

    // Third pass: enrich with place data and calculate travel times / directions
    let previousCoordinates = null;
    for (let i = 0; i < day.activities.length; i++) {
      const activity = day.activities[i];

      if (activity.type === "break") {
        continue;
      }

      if (
        !activity.type ||
        !["restaurant", "hotel", "attraction"].includes(activity.type)
      ) {
        continue;
      }

      // Find the place we already fetched
      const item = activitiesWithPlaces.find((a) => a.activity === activity);
      const place = item
        ? item.place
        : await searchPlaceForActivity(activity, profile, userId);

      if (place) {
        // Fill in real-world details
        activity.activity = place.name || activity.activity;
        activity.location =
          place.formatted_address || activity.location || profile.destination;
        // Build proper Google Maps link with place_id or address
        activity.googleMapsLink = buildGoogleMapsLinkFromPlace(place);

        // Also add a "Get Directions" link - use place_id for better accuracy
        if (place.place_id) {
          activity.directionsLink = `https://www.google.com/maps/dir/?api=1&destination_place_id=${place.place_id}`;
        } else if (place.geometry && place.geometry.location) {
          const lat = place.geometry.location.lat;
          const lng = place.geometry.location.lng;
          activity.directionsLink = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        }

        // Get high-quality image - always try to get photos
        if (place.photos && place.photos.length > 0) {
          // Use the first photo with high quality
          activity.imageUrl = buildPhotoUrlFromPlace(place, 1200);
        } else if (place.place_id) {
          // If no photos in initial result, fetch details to get photos
          const details = await getPlaceDetails(place.place_id);
          if (details && details.photos && details.photos.length > 0) {
            activity.imageUrl = buildPhotoUrlFromPlace(details, 1200);
            // Update place with photos for future reference
            place.photos = details.photos;
          }
        }

        if (
          place.opening_hours &&
          Array.isArray(place.opening_hours.weekday_text)
        ) {
          activity.openingHours = place.opening_hours.weekday_text;
        }

        activity.rating = place.rating;
        activity.priceLevel = place.price_level;
        activity.website = place.website;
        activity.phone = place.international_phone_number;

        // Store coordinates for travel time and directions between stops
        if (place.geometry && place.geometry.location) {
          activity.coordinates = {
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
          };
          // If we have a previous stop, calculate travel info between them
          if (previousCoordinates) {
            try {
              // Match Google Directions mode to user preference
              let mode = "walking";
              if (profile.transportation === "public-transport") {
                mode = "transit";
              } else if (
                profile.transportation === "rideshare" ||
                profile.transportation === "car-rental"
              ) {
                mode = "driving";
              } else if (profile.transportation === "bike") {
                mode = "bicycling";
              }

              const travelInfo = await calculateTravelTime(
                previousCoordinates,
                activity.coordinates,
                mode
              );

              if (travelInfo) {
                let modeLabel = "Walk";
                if (mode === "transit")
                  modeLabel = "Public transit (bus/train)";
                else if (mode === "driving") modeLabel = "Car / rideshare";
                else if (mode === "bicycling") modeLabel = "Bike";

                // Short, friendly summary for UI
                activity.travelSummary = `${modeLabel} ≈ ${travelInfo.duration} (${travelInfo.distance}) from previous stop`;
              }
            } catch (err) {
              console.error("Travel time calculation error:", err.message);
            }
          }

          // Update previousCoordinates for next hop
          previousCoordinates = activity.coordinates;
        }
      } else {
        // If place not found, try a more generic search
        console.log(
          `Place not found for: ${activity.activity}, trying alternative search...`
        );
      }

      // Reduced delay for faster processing
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return itinerary;
}

// Generate personalized itinerary
app.post("/api/generate-itinerary", async (req, res) => {
  try {
    const profile = req.body;
    const userId = profile.userId || "default";
    userProfiles[userId] = profile;

    const prompt = `You are a professional travel planner creating a detailed, personalized ${
      profile.days
    }-day itinerary for ${
      profile.destination
    }. Use ONLY the BEST, MOST POPULAR, and HIGHLY-RATED places from Google.

CRITICAL REQUIREMENTS:
1. You MUST create an itinerary for ALL ${
      profile.days
    } days. Each day must be complete and unique.
2. Times MUST be SEQUENTIAL throughout each day. ALWAYS start at 8:00 AM and end by 10:00 PM.
3. Maintain 3-hour gaps between activities (including travel and activity time). Schedule:
   - 8:00 AM - 11:00 AM: First activity/attraction (3 hours)
   - 11:00 AM - 2:00 PM: Lunch break and second activity (3 hours)
   - 2:00 PM - 5:00 PM: Afternoon activity (3 hours)
   - 5:00 PM - 8:00 PM: Dinner and evening activity (3 hours)
   - 8:00 PM - 10:00 PM: Final evening activity (2 hours, ends by 10 PM)
3. Use ONLY REAL, WELL-KNOWN, HIGHLY-RATED places (4+ stars, popular on Google):
   - Top-rated restaurants with many reviews
   - Must-see attractions and landmarks
   - Popular tourist destinations
   - Highly-reviewed local favorites
4. Every restaurant, attraction, and hotel must be a real, searchable location with actual addresses.
5. NO PLACE REPETITION - each place can only appear ONCE across all days.
6. Group nearby places together in the same day to minimize travel time.
7. Respect ALL user preferences STRICTLY – this is mandatory, not optional:
   - Preferred experiences: every activity must clearly match at least one selected experience category.
   - Dietary restrictions: if they have any (e.g. vegetarian, vegan, halal, kosher, gluten-free), ONLY suggest restaurants that match this.
   - Activities to avoid: NEVER include anything that matches these (0 tolerance).
   - Must-see attractions: you MUST include all of them across the itinerary in logical places.
   - Pacing: relaxed = fewer activities + more breaks; fast-paced = more activities + minimal downtime; balanced = in-between.
   - Budget: choose restaurants/hotels/activities that realistically match the budget description.
   - Transportation: route choices should align with this preference (walking vs public transport vs rideshare/car).
8. Use 12-hour time format (AM/PM) for all times (e.g., "8:00 AM", "11:00 AM", "2:00 PM", "5:00 PM", "8:00 PM").

User Preferences (STRICT REQUIREMENTS):
- Destination: ${profile.destination}
- Travel Days: ${profile.days} (MUST create itinerary for ALL ${
      profile.days
    } days - if 2 days, create exactly 2 complete days)
- Preferred Experiences: ${profile.experiences.join(", ")}
- Dietary Restrictions: ${profile.dietary || "None"} ${
      profile.dietary && profile.dietary !== "none"
        ? "(ONLY suggest places that match this)"
        : ""
    }
- Transportation: ${profile.transportation}
- Accommodation Priority: ${profile.accommodation}
- Budget: ${profile.budget}
- Pacing: ${profile.pacing} ${
      profile.pacing === "relaxed"
        ? "(fewer activities, more breaks)"
        : profile.pacing === "fast-paced"
        ? "(more activities, tighter schedule)"
        : "(balanced)"
    }
- Activities to Avoid: ${profile.avoid || "None"} ${
      profile.avoid ? "(DO NOT include any of these)" : ""
    }
- Must-See Attractions: ${profile.mustSee || "None"} ${
      profile.mustSee ? "(MUST include these in appropriate days)" : ""
    }

Create a COMPLETE day-by-day, SEQUENTIAL itinerary for ALL ${
      profile.days
    } days with:
1. REAL, SPECIFIC, BEST restaurant names with full addresses (matching dietary requirements exactly) - choose top-rated, popular places
2. REAL hotel recommendations (matching accommodation priority and budget) - choose well-known, reputable hotels
3. REAL attractions, landmarks, and MUST-SEE destinations that are popular and highly-rated on Google
4. SEQUENTIAL time slots starting at 8:00 AM and ending by 10:00 PM with 3-hour gaps between activities:
   - 8:00 AM - 11:00 AM: First activity
   - 11:00 AM - 2:00 PM: Second activity (can include lunch)
   - 2:00 PM - 5:00 PM: Third activity
   - 5:00 PM - 8:00 PM: Fourth activity (can include dinner)
   - 8:00 PM - 10:00 PM: Final evening activity
5. Group nearby places together to minimize travel time
6. Google Maps search links (format: https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS)
7. Transportation recommendations matching user preference (${
      profile.transportation
    })
8. NO REPEATING PLACES - each place appears only once
9. Each activity should account for 3 hours total (including travel time and the activity itself)

Format the response as JSON with this structure. IMPORTANT: Include ALL ${
      profile.days
    } days in the "days" array. Times must be sequential:
{
  "days": [
    {
      "day": 1,
      "date": "Day 1",
      "activities": [
        {
          "time": "8:00 AM",
          "activity": "[BEST popular attraction name]",
          "type": "attraction",
          "location": "Full address",
          "description": "Detailed description",
          "duration": "3 hours",
          "googleMapsLink": "https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS",
          "transportation": "Walking/Subway/Bus/Uber"
        },
        {
          "time": "11:00 AM",
          "activity": "[BEST popular attraction or restaurant - different from above]",
          "type": "attraction|restaurant",
          "location": "Full address",
          "description": "Detailed description",
          "duration": "3 hours",
          "googleMapsLink": "https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS",
          "transportation": "Walking/Subway/Bus/Uber"
        },
        {
          "time": "2:00 PM",
          "activity": "[BEST popular attraction name - different from above]",
          "type": "attraction",
          "location": "Full address",
          "description": "Detailed description",
          "duration": "3 hours",
          "googleMapsLink": "https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS",
          "transportation": "Walking/Subway/Bus/Uber"
        },
        {
          "time": "5:00 PM",
          "activity": "[BEST popular restaurant or attraction - different from above]",
          "type": "restaurant|attraction",
          "location": "Full address",
          "description": "Detailed description",
          "duration": "3 hours",
          "googleMapsLink": "https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS",
          "transportation": "Walking/Subway/Bus/Uber"
        },
        {
          "time": "8:00 PM",
          "activity": "[BEST popular evening activity]",
          "type": "attraction",
          "location": "Full address",
          "description": "Detailed description",
          "duration": "2 hours",
          "googleMapsLink": "https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS",
          "transportation": "Walking/Subway/Bus/Uber"
        }
      ]
    },
    {
      "day": 2,
      "date": "Day 2",
      "activities": [...]
    }
    ${profile.days > 2 ? `... continue for all ${profile.days} days` : ""}
  ],
  "summary": "Brief overview of the trip"
}

REMEMBER: The "days" array must contain exactly ${
      profile.days
    } day objects, one for each day of the trip.`;

    let completion;
    try {
      // GPT-4 supports up to 8192 completion tokens
      const maxTokensGPT4 = Math.min(8192, 3000 + profile.days * 800);
      completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a professional travel planner. Always provide REAL, BEST, MOST POPULAR locations (4+ stars, highly-rated on Google) with full addresses. Use ONLY well-known, highly-rated places. NO PLACE REPETITION - each place appears only once. Group nearby places together. Times MUST be sequential starting at 8:00 AM and ending by 10:00 PM. Maintain 3-hour gaps between activities (8 AM-11 AM, 11 AM-2 PM, 2 PM-5 PM, 5 PM-8 PM, 8 PM-10 PM). Use 12-hour time format (AM/PM). Format responses as valid JSON only. For Google Maps links, use format: https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS. CRITICAL: When asked for a multi-day itinerary, you MUST generate ALL requested days with complete, sequential activities. Never skip days or provide incomplete itineraries.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: maxTokensGPT4,
      });
    } catch (gpt4Error) {
      // Fallback to GPT-3.5-turbo if GPT-4 is unavailable
      console.log("⚠️ GPT-4 unavailable, falling back to GPT-3.5-turbo");
      console.error("GPT-4 Error:", gpt4Error.message);

      if (gpt4Error.status === 401) {
        console.error(
          "❌ OpenAI API Error: Invalid API key. Please check your OPENAI_API_KEY in .env file"
        );
      } else if (gpt4Error.status === 429) {
        console.error(
          "❌ OpenAI API Error: Rate limit exceeded. Please try again later."
        );
      }

      try {
        // GPT-3.5-turbo supports up to 4096 completion tokens
        const maxTokensGPT35 = Math.min(4096, 2500 + profile.days * 500);
        completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: `You are a professional travel planner. Always provide REAL, BEST, MOST POPULAR locations (4+ stars, highly-rated on Google) with full addresses. Use ONLY well-known, highly-rated places. NO PLACE REPETITION - each place appears only once. Group nearby places together. Times MUST be sequential starting at 8:00 AM and ending by 10:00 PM. Maintain 3-hour gaps between activities (8 AM-11 AM, 11 AM-2 PM, 2 PM-5 PM, 5 PM-8 PM, 8 PM-10 PM). Use 12-hour time format (AM/PM). Format responses as valid JSON only. For Google Maps links, use format: https://www.google.com/maps/search/?api=1&query=PLACE_NAME,ADDRESS. CRITICAL: When asked for a multi-day itinerary, you MUST generate ALL requested days with complete, sequential activities. Never skip days or provide incomplete itineraries.`,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: maxTokensGPT35,
        });
      } catch (gpt35Error) {
        console.error("❌ Both GPT-4 and GPT-3.5-turbo failed");
        console.error("GPT-3.5 Error:", gpt35Error.message);
        if (gpt35Error.status === 401) {
          throw new Error(
            "Invalid OpenAI API key. Please check your .env file."
          );
        }
        throw gpt35Error;
      }
    }

    const responseText = completion.choices[0].message.content;

    // Try to extract JSON from the response
    let itinerary;
    try {
      // Remove markdown code blocks if present
      let cleanedText = responseText.trim();
      if (cleanedText.startsWith("```json")) {
        cleanedText = cleanedText
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "");
      } else if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/```\n?/g, "");
      }

      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        itinerary = JSON.parse(jsonMatch[0]);
      } else {
        itinerary = JSON.parse(cleanedText);
      }

      // Ensure itinerary has required structure
      if (!itinerary.days) {
        itinerary.days = [];
      }
      if (!itinerary.summary && responseText) {
        itinerary.summary = responseText.substring(0, 500);
      }

      // Validate that all requested days are present
      const expectedDays = profile.days;
      const actualDays = itinerary.days.length;

      if (actualDays < expectedDays) {
        console.warn(
          `Warning: Only ${actualDays} days generated, but ${expectedDays} days requested.`
        );

        // If we're missing days, try to generate them or at least inform the user
        if (actualDays > 0) {
          // Fill in missing days with a placeholder or regenerate
          const missingDays = expectedDays - actualDays;
          console.log(
            `Missing ${missingDays} day(s). Attempting to add placeholder days.`
          );

          // Add placeholder days for missing ones
          for (let dayNum = actualDays + 1; dayNum <= expectedDays; dayNum++) {
            itinerary.days.push({
              day: dayNum,
              date: `Day ${dayNum}`,
              activities: [
                {
                  time: "09:00",
                  activity:
                    "Itinerary details for this day are being generated",
                  type: "break",
                  location: profile.destination,
                  description:
                    "Please refresh or regenerate the itinerary to see full details for this day.",
                  duration: "Full day",
                  googleMapsLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    profile.destination
                  )}`,
                  transportation: profile.transportation,
                },
              ],
            });
          }
        }
      }

      // Ensure day numbers are correct and convert times to 12-hour format
      itinerary.days.forEach((day, index) => {
        if (!day.day || day.day !== index + 1) {
          day.day = index + 1;
        }
        if (!day.date) {
          day.date = `Day ${day.day}`;
        }

        // Validate, fix, and convert all times to 12-hour format, then sort activities by time
        if (day.activities && Array.isArray(day.activities)) {
          day.activities.forEach((activity, actIndex) => {
            if (activity.time) {
              activity.time = validateAndFixTime(activity.time, actIndex);
            } else {
              // If no time, assign default based on index
              const defaultTimes = [
                "8:00 AM",
                "11:00 AM",
                "2:00 PM",
                "5:00 PM",
                "8:00 PM",
              ];
              activity.time = defaultTimes[actIndex % defaultTimes.length];
            }
          });

          // Sort activities by time to ensure sequential order
          day.activities.sort((a, b) => {
            const timeA = parseTimeToMinutes(a.time);
            const timeB = parseTimeToMinutes(b.time);
            return timeA - timeB;
          });

          // Enforce max number of activities per day based on pacing (meals excluded)
          const targetActivities =
            profile.pacing === "relaxed"
              ? 3
              : profile.pacing === "fast-paced"
              ? 8
              : 5; // default: moderate/balanced

          let nonMealCount = 0;
          day.activities = day.activities.filter((activity) => {
            const name = (activity.activity || "").toLowerCase();
            const isRestaurant = activity.type === "restaurant";

            // Try to detect meals more robustly:
            //  - by explicit keywords in the name, OR
            //  - by restaurant type + time window (breakfast / lunch / dinner slots)
            const minutes = parseTimeToMinutes(activity.time || "");

            const isBreakfastTime = minutes >= 7 * 60 && minutes <= 10 * 60; // 7–10 AM
            const isLunchTime = minutes >= 11 * 60 && minutes <= 15 * 60; // 11 AM–3 PM
            const isDinnerTime = minutes >= 18 * 60 && minutes <= 21 * 60; // 6–9 PM

            const isMealByName =
              name.includes("breakfast") ||
              name.includes("brunch") ||
              name.includes("lunch") ||
              name.includes("dinner");

            const isMealByTime =
              isRestaurant && (isBreakfastTime || isLunchTime || isDinnerTime);

            const isMeal = isMealByName || isMealByTime;

            // Meals never count toward activity cap
            if (isMeal) return true;

            nonMealCount += 1;
            // Keep only up to targetActivities non-meal activities
            return nonMealCount <= targetActivities;
          });

          // After enforcing counts, reassign times to ensure 3-hour gaps starting from 8 AM
          const validTimes = [
            "8:00 AM",
            "11:00 AM",
            "2:00 PM",
            "5:00 PM",
            "8:00 PM",
          ];
          day.activities.forEach((activity, actIndex) => {
            if (actIndex < validTimes.length) {
              activity.time = validTimes[actIndex];
            } else {
              // If more than 5 activities, space them out
              const lastTime = parseTimeToMinutes(
                validTimes[validTimes.length - 1]
              );
              const newMinutes =
                lastTime + (actIndex - validTimes.length + 1) * 180; // 3 hours = 180 minutes
              if (newMinutes <= 22 * 60) {
                // Don't exceed 10 PM
                const hours = Math.floor(newMinutes / 60);
                const mins = newMinutes % 60;
                const period = hours >= 12 ? "PM" : "AM";
                let displayHours =
                  hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
                activity.time = `${displayHours}:${mins
                  .toString()
                  .padStart(2, "0")} ${period}`;
              } else {
                activity.time = "10:00 PM";
              }
            }
          });
        }
      });

      // Ensure we have a top-level hotel recommendation
      if (!itinerary.hotel) {
        try {
          const hotelQuery =
            (profile.accommodation || "hotel") +
            " hotel " +
            profile.destination;
          const hotelActivity = {
            activity: hotelQuery,
            type: "hotel",
          };
          const hotelPlace = await searchPlaceForActivity(
            hotelActivity,
            profile,
            userId
          );
          if (hotelPlace) {
            itinerary.hotel = {
              name: hotelPlace.name || "Recommended Hotel",
              location:
                hotelPlace.formatted_address || profile.destination || "",
              description: `A well-rated hotel in ${
                profile.destination
              } that matches your preference for ${
                profile.accommodation || "comfort and convenience"
              }.`,
              imageUrl: buildPhotoUrlFromPlace(hotelPlace, 1200),
              googleMapsLink: buildGoogleMapsLinkFromPlace(hotelPlace),
            };
          }
        } catch (err) {
          console.error("Error generating hotel recommendation:", err.message);
        }
      }

      // Enrich itinerary with real-world data from Google Places
      itinerary = await enrichItineraryWithPlaces(itinerary, profile, userId);

      // Validate, fix, and convert times again after enrichment and ensure sequential order
      itinerary.days.forEach((day) => {
        if (day.activities && Array.isArray(day.activities)) {
          day.activities.forEach((activity, actIndex) => {
            if (activity.time) {
              activity.time = validateAndFixTime(activity.time, actIndex);
            } else {
              const defaultTimes = [
                "8:00 AM",
                "11:00 AM",
                "2:00 PM",
                "5:00 PM",
                "8:00 PM",
              ];
              activity.time = defaultTimes[actIndex % defaultTimes.length];
            }
          });

          // Sort activities by time again after enrichment to ensure sequential order
          day.activities.sort((a, b) => {
            const timeA = parseTimeToMinutes(a.time);
            const timeB = parseTimeToMinutes(b.time);
            return timeA - timeB;
          });

          // Reassign times to ensure 3-hour gaps starting from 8 AM
          const validTimes = [
            "8:00 AM",
            "11:00 AM",
            "2:00 PM",
            "5:00 PM",
            "8:00 PM",
          ];
          day.activities.forEach((activity, actIndex) => {
            if (actIndex < validTimes.length) {
              activity.time = validTimes[actIndex];
            } else {
              const lastTime = parseTimeToMinutes(
                validTimes[validTimes.length - 1]
              );
              const newMinutes =
                lastTime + (actIndex - validTimes.length + 1) * 180;
              if (newMinutes <= 22 * 60) {
                const hours = Math.floor(newMinutes / 60);
                const mins = newMinutes % 60;
                const period = hours >= 12 ? "PM" : "AM";
                let displayHours =
                  hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
                activity.time = `${displayHours}:${mins
                  .toString()
                  .padStart(2, "0")} ${period}`;
              } else {
                activity.time = "10:00 PM";
              }
            }
          });
        }
      });
    } catch (error) {
      console.error("JSON parsing error or enrichment error:", error);
      // If parsing/enrichment fails, create a structured response
      itinerary = {
        days: [],
        summary:
          responseText.substring(0, 500) ||
          "Your personalized itinerary has been generated. Please review the details below.",
        raw: responseText,
      };
    }

    // Persist itinerary in memory for chatbot context
    userItineraries[userId] = itinerary;

    res.json({ success: true, itinerary });
  } catch (error) {
    console.error("❌ Error generating itinerary:", error);

    let errorMessage = error.message || "Failed to generate itinerary";

    // Provide more helpful error messages
    if (error.message && error.message.includes("API key")) {
      errorMessage = "API key error: " + error.message;
    } else if (error.message && error.message.includes("rate limit")) {
      errorMessage = "Rate limit exceeded. Please try again in a few moments.";
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// AI Chatbot endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId, destination } = req.body;

    // Get user profile and itinerary if available
    const profile = userProfiles[userId] || {};
    const itinerary = userItineraries[userId] || null;

    const systemPrompt = `You are a helpful travel assistant chatbot for ${
      destination || "travelers"
    }. 
You know the user's preferences and current itinerary and you must respect them strictly.

Traveler Profile:
- Destination: ${profile.destination || destination || "Unknown"}
- Travel Days: ${profile.days || "Unknown"}
- Preferred Experiences: ${
      Array.isArray(profile.experiences)
        ? profile.experiences.join(", ")
        : "Unknown"
    }
- Dietary Restrictions: ${profile.dietary || "none"}
- Transportation Preference: ${profile.transportation || "Unknown"}
- Accommodation Priority: ${profile.accommodation || "Unknown"}
- Budget: ${profile.budget || "Unknown"}
- Pacing: ${profile.pacing || "Unknown"}
- Activities to Avoid: ${profile.avoid || "None"}
- Must-See Attractions: ${profile.mustSee || "None"}

Current Itinerary (JSON):
${
  itinerary
    ? JSON.stringify(itinerary).substring(0, 4000)
    : "No itinerary available yet."
}

You provide accurate, real-time style travel information including:
- Restaurant recommendations (respecting dietary restrictions)
- Safety information
- Hidden local spots
- Transportation options and how to adjust routes
- Cultural tips
- Suggestions to modify or improve the current itinerary while respecting constraints

Always be friendly, concise, and helpful. If you don't have specific information, suggest reliable external resources and do NOT invent facts.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const response = completion.choices[0].message.content;

    res.json({ success: true, response });
  } catch (error) {
    console.error("❌ Error in chatbot:", error);

    let errorMessage = error.message || "Failed to get chatbot response";

    if (error.status === 401) {
      errorMessage = "Invalid OpenAI API key. Please check your .env file.";
    } else if (error.status === 429) {
      errorMessage = "Rate limit exceeded. Please try again in a few moments.";
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Add startup validation
console.log("=== Travel Planner Server Starting ===");
console.log(`Port: ${PORT}`);
console.log(
  `Google API Key: ${
    GOOGLE_API_KEY ? GOOGLE_API_KEY.substring(0, 20) + "..." : "NOT SET"
  }`
);
console.log(
  `OpenAI API Key: ${
    process.env.OPENAI_API_KEY || OPENAI_API_KEY_FALLBACK
      ? (process.env.OPENAI_API_KEY || OPENAI_API_KEY_FALLBACK).substring(
          0,
          20
        ) + "..."
      : "NOT SET"
  }`
);

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log("Ready to generate travel itineraries!");
});
