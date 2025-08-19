# Timetable API Documentation

This document provides instructions for integrating with the Timetable API endpoints.

**Base URL**: `/api/timetables`

**Authentication**: All endpoints are protected. A valid JSON Web Token (JWT) must be included in the `x-auth-token` header of every request.

---

### 1. Create a Timetable

Creates a new timetable for a specific class. A class can only have one timetable. If a timetable for the specified `class_id` already exists, this endpoint will return a conflict error.

- **Method**: `POST`
- **URL**: `/api/timetables`
- **Access**: `Admin`, `SuperAdmin`
- **Body (JSON)**:

  The `timetable_data` object should contain days of the week as keys. Each day should be an array of objects, where each object represents a time slot and must include the `time`, `subject`, and the assigned teacher's unique `teacher_id`.

  ```json
  {
    "class_id": "your-class-uuid",
    "timetable_data": {
      "Monday": [
        {
          "time": "09:00 - 10:00",
          "subject": "Mathematics",
          "teacher_id": "staff-uuid-for-mr-smith"
        },
        {
          "time": "10:00 - 11:00",
          "subject": "Physics",
          "teacher_id": "staff-uuid-for-ms-jones"
        }
      ],
      "Tuesday": [
        {
          "time": "09:00 - 10:00",
          "subject": "Chemistry",
          "teacher_id": "staff-uuid-for-dr-brown"
        }
      ]
    }
  }
  ```

- **`curl` Example**:

  ```bash
  curl -X POST http://localhost:3000/api/timetables \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "class_id": "your-class-uuid",
    "timetable_data": { "Monday": [{ "time": "09:00 - 10:00", "subject": "Mathematics", "teacher_id": "staff-uuid-for-mr-smith" }] }
  }'
  ```

- **Success Response (`201 Created`)**:

  ```json
  {
    "success": true,
    "message": "Timetable created successfully.",
    "data": {
      "id": "new-timetable-uuid",
      "class_id": "your-class-uuid",
      "branch_id": "branch-uuid-for-the-class",
      "timetable_data": {
        "Monday": [
          {
            "time": "09:00 - 10:00",
            "subject": "Mathematics",
            "teacher_id": "staff-uuid-for-mr-smith"
          }
        ]
      }
    }
  }
  ```

- **Error Responses**:
  - `400 Bad Request`: If `class_id` or `timetable_data` is missing from the request body.
  - `403 Forbidden`: If an Admin tries to create a timetable for a class outside of their assigned branch.
  - `404 Not Found`: If the provided `class_id` does not correspond to an existing class.
  - `409 Conflict`: If a timetable for the provided `class_id` already exists.

---

### 2. Get Timetable for a Class

Retrieves the timetable for a specific class using the class ID. The API automatically resolves each `teacher_id` to include the teacher's name in the response.

- **Method**: `GET`
- **URL**: `/api/timetables/class/:classId`
- **Access**: `Admin`, `SuperAdmin`, `Teacher`, `Student`
- **`curl` Example**:

  ```bash
  curl -X GET http://localhost:3000/api/timetables/class/your-class-uuid \
  -H "x-auth-token: YOUR_JWT_TOKEN"
  ```

- **Success Response (`200 OK`)**:

  ```json
  {
    "success": true,
    "data": {
      "id": "existing-timetable-uuid",
      "class_id": "your-class-uuid",
      "branch_id": "branch-uuid-for-the-class",
      "timetable_data": {
        "Monday": [
          {
            "time": "09:00 - 10:00",
            "subject": "Mathematics",
            "teacher_id": "staff-uuid-for-mr-smith",
            "teacher_name": "Mr. Smith"
          }
        ]
      },
      "created_at": "2023-10-27T10:00:00.000Z",
      "updated_at": "2023-10-27T10:00:00.000Z"
    }
  }
  ```

- **Error Responses**:
  - `403 Forbidden`: If an Admin tries to view a timetable for a class outside their assigned branch.
  - `404 Not Found`: If no timetable is found for the given `classId`.

---

### 3. Update a Timetable

Updates the contents of an existing timetable using the timetable's unique ID.

- **Method**: `PUT`
- **URL**: `/api/timetables/:id`
- **Access**: `Admin`, `SuperAdmin`
- **Body (JSON)**:

  The `timetable_data` should contain the complete, updated timetable structure, using `teacher_id` for each entry.

  ```json
  {
    "timetable_data": {
      "Monday": [
        {
          "time": "09:00 - 10:00",
          "subject": "Advanced Mathematics",
          "teacher_id": "staff-uuid-for-mr-smith"
        }
      ],
      "Wednesday": [
        {
          "time": "11:00 - 12:00",
          "subject": "Biology",
          "teacher_id": "staff-uuid-for-ms-davis"
        }
      ]
    }
  }
  ```

- **`curl` Example**:

  ```bash
  curl -X PUT http://localhost:3000/api/timetables/existing-timetable-uuid \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "timetable_data": { "Monday": [{ "time": "09:00 - 10:00", "subject": "Advanced Mathematics", "teacher_id": "staff-uuid-for-mr-smith" }] }
  }'
  ```

- **Success Response (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Timetable updated successfully."
  }
  ```

- **Error Responses**:
  - `400 Bad Request`: If `timetable_data` is missing from the request body.
  - `403 Forbidden`: If an Admin tries to update a timetable from outside their assigned branch.
  - `404 Not Found`: If no timetable is found with the given ID.

---

### 4. Delete a Timetable

Deletes an existing timetable using its unique ID.

- **Method**: `DELETE`
- **URL**: `/api/timetables/:id`
- **Access**: `Admin`, `SuperAdmin`
- **`curl` Example**:

  ```bash
  curl -X DELETE http://localhost:3000/api/timetables/existing-timetable-uuid \
  -H "x-auth-token: YOUR_JWT_TOKEN"
  ```

- **Success Response (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Timetable deleted successfully."
  }
  ```

- **Error Responses**:
  - `403 Forbidden`: If an Admin tries to delete a timetable from outside their assigned branch.
  - `404 Not Found`: If no timetable is found with the given ID.
