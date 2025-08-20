# Personalized Upcoming Exams API Documentation

This document provides instructions on how to integrate the personalized "Get My Upcoming Exams" endpoint into a frontend application.

## Endpoint Overview

This intelligent endpoint retrieves a list of upcoming exams tailored to the authenticated user's role. It dynamically determines which exams to return based on whether the user is a teacher, parent, or student.

- **URL:** `/api/exams/me/upcoming`
- **Method:** `GET`
- **Authentication:** Required (JWT Token)

---

## Authorization

Access is restricted to authenticated users with one of the following roles:

- `Teacher`
- `Parent`
- `Student`
- `NewStudent`

The endpoint automatically scopes the results:

- **Teachers** see exams for the classes they are assigned to.
- **Parents** see exams for all classes their children are enrolled in.
- **Students** see exams for their own class.

---

## Request

This endpoint does not require any parameters or body content.

### Headers

| Header         | Value          | Description                                        |
| :------------- | :------------- | :------------------------------------------------- |
| `x-auth-token` | `<your_token>` | **Required.** The JWT for authenticating the user. |

---

## Responses

### ✅ Success Response (200 OK)

The server returns a JSON array of exam objects relevant to the user.

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
    }
  ]
}
```

### ❌ Error Responses

- **403 Forbidden:** The user's role is not authorized to access this endpoint.
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
async function getMyUpcomingExams(token) {
  const API_BASE_URL = "https://your-api-domain.com/api"; // Replace with your actual API base URL

  try {
    const response = await fetch(`${API_BASE_URL}/exams/me/upcoming`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": token,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Error: ${response.status} - ${data.message}`);
      return null;
    }

    console.log("Successfully fetched personalized upcoming exams:", data.data);
    return data.data;
  } catch (error) {
    console.error("An unexpected error occurred:", error);
    return null;
  }
}

// --- Example Usage ---
// const userToken = 'your_jwt_token_here'; // The logged-in user's JWT
// getMyUpcomingExams(userToken).then(exams => {
//     if (exams) {
//         // Use the exams data to update your UI
//     }
// });
```
