# Upcoming Exams API Documentation

This document provides instructions on how to integrate the "Get Upcoming Exams" endpoint into a frontend application.

## Endpoint Overview

This endpoint retrieves a list of all upcoming exams across all branches, providing key details for each. Since it is a public endpoint, no authentication is required.

- **URL:** `/api/exams/upcoming`
- **Method:** `GET`
- **Authentication:** Not Required

---

## Request

This endpoint does not require any parameters, headers (other than standard ones like `Content-Type`), or body content.

---

## Responses

### ✅ Success Response (200 OK)

The server returns a JSON array of exam objects.

```json
{
  "success": true,
  "data": [
    {
      "title": "Mid-Term Entrance Examination",
      "date": "2024-08-15T09:00:00.000Z",
      "class": "Grade 10",
      "branch": "Main Campus",
      "subjects": ["Mathematics", "English Language", "Basic Science"]
    },
    {
      "title": "Final Year Entrance Exam",
      "date": "2024-09-01T10:00:00.000Z",
      "class": "Grade 12",
      "branch": "North Campus",
      "subjects": ["Advanced Mathematics", "Literature in English", "Physics"]
    }
  ]
}
```

### ❌ Error Response

- **500 Internal Server Error:** A server-side error occurred.
  ```json
  {
    "success": false,
    "message": "Server error while fetching upcoming exams."
  }
  ```

---

## Frontend Integration Example

Here is a JavaScript example using `fetch` to call the endpoint.

```javascript
async function getUpcomingExams() {
  const API_BASE_URL = "https://your-api-domain.com/api"; // Replace with your actual API base URL

  try {
    const response = await fetch(`${API_BASE_URL}/exams/upcoming`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Error: ${response.status} - ${data.message}`);
      return null;
    }

    console.log("Successfully fetched upcoming exams:", data.data);
    return data.data;
  } catch (error) {
    console.error("An unexpected error occurred:", error);
    return null;
  }
}

// --- Example Usage ---
// getUpcomingExams().then(exams => {
//     if (exams) {
//         // Use the exams data to update your UI
//     }
// });
```
