# Staff Full Details API Documentation

This document provides instructions on how to integrate the "Get Staff Full Details" endpoint into a frontend application.

## Endpoint Overview

This endpoint retrieves comprehensive details for a specific staff member, including their personal information, role, branch, and a detailed list of classes they are associated with.

- **URL:** `/api/staff/:id/full-details`
- **Method:** `GET`
- **Authentication:** Required (JWT Bearer Token)

---

## Authorization

Access to this endpoint is restricted. The requesting user must meet one of the following criteria:

1.  Be a **SuperAdmin**.
2.  Be the **staff member** whose details are being requested (i.e., the authenticated user's ID matches the staff member's `user_id`).
3.  Be an **Admin** in the same branch as the staff member.
4.  Be a **Teacher** in the same branch as the staff member.

If the user does not meet any of these criteria, the server will respond with a `403 Forbidden` error.

---

## Request

### Path Parameters

| Parameter | Type   | Description                               |
| :-------- | :----- | :---------------------------------------- |
| `id`      | `UUID` | **Required.** The ID of the staff member. |

### Headers

| Header          | Value                 | Description                                        |
| :-------------- | :-------------------- | :------------------------------------------------- |
| `Authorization` | `Bearer <your_token>` | **Required.** The JWT for authenticating the user. |

---

## Responses

### ✅ Success Response (200 OK)

The server returns a JSON object containing the staff member's full details.

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "user_id": "user-uuid-12345",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "phone": "123-456-7890",
    "address": "123 Main St, Anytown, USA",
    "gender": "Female",
    "description": "Experienced educator specializing in Mathematics.",
    "status": "active",
    "image_url": "https://example.com/images/jane_doe.jpg",
    "branch_id": "branch-uuid-67890",
    "role_id": "role-uuid-abcde",
    "created_at": "2023-10-27T10:00:00.000Z",
    "role": "Teacher",
    "branch": "Main Campus",
    "classes": [
      {
        "id": "class-uuid-001",
        "name": "Grade 10 Math",
        "teacher": {
          "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
          "name": "Jane Doe"
        },
        "subjects": [
          {
            "id": "subject-uuid-math",
            "name": "Mathematics",
            "teacher": {
              "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
              "name": "Jane Doe"
            }
          }
        ],
        "students": [
          {
            "id": "student-uuid-01",
            "name": "John Smith"
          },
          {
            "id": "student-uuid-02",
            "name": "Emily White"
          }
        ],
        "studentCount": 2
      }
    ]
  }
}
```

### ❌ Error Responses

- **403 Forbidden:** The user is not authorized to view the details.

  ```json
  {
    "success": false,
    "message": "You are not authorized to view these details."
  }
  ```

- **404 Not Found:** The staff member with the specified `id` does not exist.

  ```json
  {
    "success": false,
    "message": "Staff member not found."
  }
  ```

- **500 Internal Server Error:** A server-side error occurred.

  ```json
  {
    "success": false,
    "message": "Server error while fetching teacher details."
  }
  ```

---

## Frontend Integration Example

Here is a JavaScript example using `fetch` to call the endpoint.

```javascript
async function getStaffDetails(staffId, token) {
  const API_BASE_URL = "https://your-api-domain.com/api"; // Replace with your actual API base URL

  try {
    const response = await fetch(
      `${API_BASE_URL}/staff/${staffId}/full-details`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Handle non-successful responses (4xx, 5xx)
      console.error(`Error: ${response.status} - ${data.message}`);
      // You could show an error message to the user here
      return null;
    }

    // On success, return the staff data
    console.log("Successfully fetched staff details:", data.data);
    return data.data;
  } catch (error) {
    // Handle network errors or other exceptions
    console.error("An unexpected error occurred:", error);
    // You could show a generic error message to the user
    return null;
  }
}

// --- Example Usage ---
// const staffId = 'a1b2c3d4-e5f6-7890-1234-567890abcdef'; // The ID of the staff to fetch
// const userToken = 'your_jwt_token_here'; // The logged-in user's JWT

// getStaffDetails(staffId, userToken).then(staffData => {
//     if (staffData) {
//         // Use the staffData to update your UI
//     }
// });
```
