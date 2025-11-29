// Global state
let currentUserId = "user_" + Date.now();
let userProfile = null;

// DOM Elements
const questionnaireSection = document.getElementById("questionnaire-section");
const itinerarySection = document.getElementById("itinerary-section");
const questionnaireForm = document.getElementById("tipi-questionnaire");
const itineraryContent = document.getElementById("itinerary-content");
const loadingDiv = document.getElementById("loading");
const backToQuestionnaireBtn = document.getElementById("back-to-questionnaire");

// Chatbot elements
const chatbotToggle = document.getElementById("chatbot-toggle");
const chatbotWindow = document.getElementById("chatbot-window");
const chatbotClose = document.getElementById("chatbot-close");
const chatbotMessages = document.getElementById("chatbot-messages");
const chatbotInput = document.getElementById("chatbot-input");
const chatbotSend = document.getElementById("chatbot-send");

// Event Listeners
questionnaireForm.addEventListener("submit", handleQuestionnaireSubmit);
backToQuestionnaireBtn.addEventListener("click", () => {
  questionnaireSection.classList.add("active");
  itinerarySection.classList.remove("active");
  questionnaireForm.reset();
});

// Chatbot toggle
chatbotToggle.addEventListener("click", () => {
  chatbotWindow.classList.toggle("hidden");
});

chatbotClose.addEventListener("click", () => {
  chatbotWindow.classList.add("hidden");
});

// Chatbot send message
chatbotSend.addEventListener("click", sendChatMessage);
chatbotInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendChatMessage();
  }
});

// Handle questionnaire submission
async function handleQuestionnaireSubmit(e) {
  e.preventDefault();

  // Collect form data
  const formData = new FormData(questionnaireForm);
  const experiences = Array.from(
    document.querySelectorAll('input[name="experiences"]:checked')
  ).map((cb) => cb.value);

  if (experiences.length === 0) {
    alert("Please select at least one preferred experience.");
    return;
  }

  userProfile = {
    userId: currentUserId,
    destination: formData.get("destination"),
    days: parseInt(formData.get("days")),
    experiences: experiences,
    dietary: formData.get("dietary"),
    transportation: formData.get("transportation"),
    accommodation: formData.get("accommodation"),
    budget: formData.get("budget"),
    pacing: formData.get("pacing"),
    avoid: formData.get("avoid") || "",
    mustSee: formData.get("mustSee") || "",
  };

  // Show loading and switch to itinerary section
  questionnaireSection.classList.remove("active");
  itinerarySection.classList.add("active");
  loadingDiv.classList.remove("hidden");
  itineraryContent.innerHTML = "";

  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Update loading message
  const loadingMessages = [
    "Gathering travel preferences...",
    "Searching for the best places...",
    "Finding restaurants matching your diet...",
    "Calculating travel times...",
    "Adding real photos and details...",
    "Creating your perfect itinerary...",
  ];

  let messageIndex = 0;
  const loadingText = loadingDiv.querySelector("p");
  const messageInterval = setInterval(() => {
    if (loadingText && messageIndex < loadingMessages.length) {
      loadingText.textContent = loadingMessages[messageIndex];
      messageIndex++;
    }
  }, 2000);

  try {
    const response = await fetch("/api/generate-itinerary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userProfile),
    });

    const data = await response.json();

    clearInterval(messageInterval);

    if (data.success) {
      if (loadingText) {
        loadingText.textContent = "Finalizing your itinerary...";
      }
      // Small delay for better UX
      setTimeout(() => {
        displayItinerary(data.itinerary);
        loadingDiv.classList.add("hidden");
        // Scroll to itinerary
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }, 100);
      }, 500);
    } else {
      throw new Error(data.error || "Failed to generate itinerary");
    }
  } catch (error) {
    clearInterval(messageInterval);
    console.error("Error:", error);
    loadingDiv.classList.add("hidden");
    itineraryContent.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #d32f2f; background: white; border-radius: 15px; box-shadow: var(--shadow-lg);">
                <div style="font-size: 3rem; margin-bottom: 1rem;">😔</div>
                <h3 style="margin-bottom: 1rem;">Error generating itinerary</h3>
                <p style="margin-bottom: 1rem;">${error.message}</p>
                <p style="margin-top: 1rem; font-size: 0.9rem; color: #666;">Please try again or check your connection.</p>
                <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 1.5rem;">Try Again</button>
            </div>
        `;
  }
}

// Helper function to generate star rating
function generateStarRating(rating) {
  if (!rating) return "";
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  let stars = "⭐".repeat(fullStars);
  if (hasHalfStar) stars += "⭐";
  return `<span class="rating-stars">${stars}</span>`;
}

// Helper function to get price level indicator
function getPriceLevel(priceLevel) {
  if (priceLevel === undefined || priceLevel === null) return "";
  const symbols = ["$", "$$", "$$$", "$$$$"];
  return `<span class="price-level">${symbols[priceLevel - 1] || ""}</span>`;
}

// Display itinerary
function displayItinerary(itinerary) {
  if (!itinerary || !itinerary.days || itinerary.days.length === 0) {
    itineraryContent.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <h3>Itinerary Generated!</h3>
                <p>${
                  itinerary.summary ||
                  itinerary.raw ||
                  "Your personalized itinerary has been created."
                }</p>
            </div>
        `;
    return;
  }

  let html = "";

  // Summary
  if (itinerary.summary) {
    html += `
            <div class="itinerary-summary">
                <h3>📋 Trip Overview</h3>
                <p>${itinerary.summary}</p>
            </div>
        `;
  }

  // Hotel recommendation (trip-wide)
  if (itinerary.hotel) {
    const hotel = itinerary.hotel;
    html += `
            <div class="itinerary-day">
                <div class="day-header">
                    <h3>🏨 Recommended Hotel</h3>
                </div>
                <div class="activity-item">
                    <div class="activity-number">★</div>
                    <div class="activity-main">
                        <div class="activity-content">
                            <div class="activity-name">${
                              hotel.name || "Hotel"
                            }</div>
                            <span class="activity-type">hotel</span>
                            ${
                              hotel.description
                                ? `<div class="activity-description">${hotel.description}</div>`
                                : ""
                            }
                            <div class="activity-details">
                                ${
                                  hotel.location
                                    ? `
                                <div class="activity-detail">
                                    <span class="detail-icon">📍</span> <span>${hotel.location}</span>
                                </div>
                                `
                                    : ""
                                }
                                <div class="activity-actions">
                                ${
                                  hotel.googleMapsLink
                                    ? `
                                    <a href="${hotel.googleMapsLink}" target="_blank" class="maps-link">🗺️ View Hotel on Google Maps →</a>
                                    `
                                    : ""
                                }
                                </div>
                            </div>
                        </div>
                        ${
                          hotel.imageUrl
                            ? `
                        <div class="activity-image-wrapper">
                            <img src="${hotel.imageUrl}" 
                                 alt="${hotel.name || "Hotel"}" 
                                 loading="lazy" />
                        </div>
                        `
                            : `
                        <div class="activity-image-wrapper">
                            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:2.5rem;">
                                🏨
                            </div>
                        </div>
                        `
                        }
                    </div>
                </div>
            </div>
        `;
  }

  // Days
  itinerary.days.forEach((day, index) => {
    html += `
            <div class="itinerary-day">
                <div class="day-header">
                    <h3>Day ${day.day || index + 1}: ${
      day.date || `Day ${index + 1}`
    }</h3>
                </div>
        `;

    if (day.activities && day.activities.length > 0) {
      day.activities.forEach((activity, actIndex) => {
        const typeEmoji =
          {
            attraction: "🎯",
            restaurant: "🍽️",
            hotel: "🏨",
            break: "☕",
          }[activity.type] || "📍";

        // Always show image if available, make it prominent
        // Use a gradient placeholder if no image is available
        const imageHtml = activity.imageUrl
          ? `
                    <div class="activity-image-wrapper">
                        <img src="${activity.imageUrl}" 
                             alt="${activity.activity || "Location"}" 
                             loading="lazy"
                             onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);color:white;font-size:2rem;\\'>${typeEmoji}</div>';" />
                    </div>
                `
          : `
                    <div class="activity-image-wrapper" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 3rem;">
                        ${typeEmoji}
                    </div>
                `;

        html += `
                    <div class="activity-item" style="animation-delay: ${
                      actIndex * 0.05
                    }s">
                        <div class="activity-number">${actIndex + 1}</div>
                        <div class="activity-main">
                            <div class="activity-content">
                                <div class="activity-time">${
                                  activity.time || "TBD"
                                }</div>
                                <div class="activity-name">${
                                  activity.activity || "Activity"
                                }</div>
                                <span class="activity-type">${
                                  activity.type || "activity"
                                }</span>
                                ${
                                  activity.description
                                    ? `<div class="activity-description">${activity.description}</div>`
                                    : ""
                                }
                                <div class="activity-details">
                            ${
                              activity.location
                                ? `
                                <div class="activity-detail">
                                    <span class="detail-icon">📍</span> <span>${activity.location}</span>
                                </div>
                            `
                                : ""
                            }
                            ${
                              activity.openingHours &&
                              Array.isArray(activity.openingHours) &&
                              activity.openingHours.length
                                ? `
                                <div class="activity-detail">
                                    <span class="detail-icon">⏰</span>
                                    <span>${activity.openingHours.join(
                                      "<br>"
                                    )}</span>
                                </div>
                            `
                                : ""
                            }
                            ${
                              activity.travelSummary
                                ? `
                                <div class="activity-detail">
                                    <span class="detail-icon">🚌</span> <span>${activity.travelSummary}</span>
                                </div>
                            `
                                : ""
                            }
                            <div class="activity-actions">
                            ${
                              activity.googleMapsLink
                                ? `
                                <a href="${activity.googleMapsLink}" target="_blank" class="maps-link">🗺️ View on Google Maps →</a>
                            `
                                : ""
                            }
                            </div>
                                </div>
                            </div>
                            ${imageHtml}
                        </div>
                    </div>
                `;
      });
    }

    html += `</div>`;
  });

  itineraryContent.innerHTML = html;

  // Add smooth scroll animations with travel-themed effects
  const items = itineraryContent.querySelectorAll(".activity-item");
  items.forEach((item, index) => {
    item.style.opacity = "0";
    item.style.transform = "translateY(30px) scale(0.95)";
    item.style.animationDelay = `${index * 0.1}s`;
    setTimeout(() => {
      item.style.transition =
        "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
      item.style.opacity = "1";
      item.style.transform = "translateY(0) scale(1)";
    }, index * 100);
  });

  // Add scroll-triggered reveal effects (no parallax movement)
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0) scale(1)";
        entry.target.classList.add("travel-revealed");
      }
    });
  }, observerOptions);

  items.forEach((item) => {
    observer.observe(item);
  });

  // Show chatbot toggle with animation if hidden
  if (chatbotToggle) {
    chatbotToggle.style.animation = "pulse 2s ease-in-out infinite";
  }

  // Add click handlers for images to open in new tab
  const images = itineraryContent.querySelectorAll(
    ".activity-image-wrapper img"
  );
  images.forEach((img) => {
    img.style.cursor = "pointer";
    img.addEventListener("click", () => {
      window.open(img.src, "_blank");
    });
  });
}

// Chatbot functions
function showTypingIndicator() {
  const typingDiv = document.createElement("div");
  typingDiv.id = "typing-indicator";
  typingDiv.className = "message bot typing-indicator";
  typingDiv.innerHTML = "<span></span><span></span><span></span>";
  chatbotMessages.appendChild(typingDiv);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
}

function hideTypingIndicator() {
  const typing = document.getElementById("typing-indicator");
  if (typing) {
    typing.remove();
  }
}

function sendChatMessage() {
  const message = chatbotInput.value.trim();
  if (!message) return;

  // Disable input while processing
  chatbotInput.disabled = true;
  chatbotSend.disabled = true;

  // Add user message to chat
  addChatMessage(message, "user");
  chatbotInput.value = "";

  // Show typing indicator
  showTypingIndicator();

  // Get bot response
  fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: message,
      userId: currentUserId,
      destination: userProfile?.destination || "",
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      hideTypingIndicator();
      if (data.success) {
        addChatMessage(data.response, "bot");
      } else {
        addChatMessage(
          "Sorry, I encountered an error. Please try again.",
          "bot"
        );
      }
    })
    .catch((error) => {
      console.error("Chat error:", error);
      hideTypingIndicator();
      addChatMessage(
        "Sorry, I'm having trouble connecting. Please check your connection.",
        "bot"
      );
    })
    .finally(() => {
      chatbotInput.disabled = false;
      chatbotSend.disabled = false;
      chatbotInput.focus();
    });
}

function addChatMessage(text, sender) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${sender}`;

  // Format message with line breaks
  const formattedText = text.replace(/\n/g, "<br>");
  messageDiv.innerHTML = formattedText;

  chatbotMessages.appendChild(messageDiv);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  // Add typing indicator for bot messages
  if (sender === "bot") {
    messageDiv.style.opacity = "0";
    setTimeout(() => {
      messageDiv.style.transition = "opacity 0.3s ease";
      messageDiv.style.opacity = "1";
    }, 100);
  }
}

// Initialize chatbot with welcome message
window.addEventListener("load", () => {
  setTimeout(() => {
    addChatMessage(
      "Hello! I'm your AI Travel Assistant. Ask me anything about your trip!",
      "bot"
    );
  }, 500);
});
