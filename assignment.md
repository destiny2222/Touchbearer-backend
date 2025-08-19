# Assignment API Documentation

This document provides instructions for integrating with the Assignment API endpoints.

**Base URL**: `/api/assignments`

**Authentication**: All endpoints are protected. A valid JSON Web Token (JWT) must be included in the `x-auth-token` header of every request.

---

### 1. Create an Assignment

Creates a new assignment for a specific class. This endpoint is restricted to teachers, who can only create assignments for the class they are assigned to.

- **Method**: `POST`
- **URL**: `/api/assignments`
- **Access**: `Teacher`
- **Body (JSON)**:

| Field      | Type     | Description                                            | Required |
| ---------- | -------- | ------------------------------------------------------ | -------- |
| `title`    | `String` | The title of the assignment.                           | Yes      |
| `class_id` | `String` | The unique ID of the class for the assignment.         | Yes      |
| `subject`  | `String` | The subject of the assignment (e.g., "Math").          | Yes      |
| `due_date` | `String` | The submission deadline (e.g., "2023-12-31 23:59:59"). | Yes      |
| `details`  | `String` | A detailed description of the assignment.              | No       |

- **`curl` Example**:

  ```bash
  curl -X POST http://localhost:3000/api/assignments \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_TEACHER_JWT_TOKEN" \
  -d '{
    "title": "Chapter 5 Problem Set",
    "class_id": "your-class-uuid",
    "subject": "Mathematics",
    "due_date": "2024-01-15 17:00:00",
    "details": "Complete all odd-numbered questions from chapter 5."
  }'
  ```

- **Success Response (`201 Created`)**:

  ```json
  {
    "success": true,
    "message": "Assignment created successfully.",
    "data": {
      "id": "new-assignment-uuid",
      "title": "Chapter 5 Problem Set",
      "details": "Complete all odd-numbered questions from chapter 5.",
      "class_id": "your-class-uuid",
      "branch_id": "branch-uuid-for-the-class",
      "teacher_id": "teacher-staff-uuid",
      "subject": "Mathematics",
      "due_date": "2024-01-15T17:00:00.000Z"
    }
  }
  ```

- **Error Responses**:
  - `400 Bad Request`: If any required fields are missing.
  - `403 Forbidden`: If the user is not a teacher or is trying to create an assignment for a class they are not assigned to.
  - `404 Not Found`: If the `class_id` does not exist.

---

### 2. Get Assignments for a Class

Retrieves all assignments for a specific class, ordered by the due date.

- **Method**: `GET`
- **URL**: `/api/assignments/class/:classId`
- **Access**: `Teacher`, `Student`
- **`curl` Example**:

  ```bash
  curl -X GET http://localhost:3000/api/assignments/class/your-class-uuid \
  -H "x-auth-token: YOUR_JWT_TOKEN"
  ```

- **Success Response (`200 OK`)**:

  ```json
  {
    "success": true,
    "data": [
      {
        "id": "assignment-uuid-1",
        "title": "Chapter 5 Problem Set",
        "details": "Complete all odd-numbered questions from chapter 5.",
        "class_id": "your-class-uuid",
        "branch_id": "branch-uuid-for-the-class",
        "teacher_id": "teacher-staff-uuid",
        "subject": "Mathematics",
        "due_date": "2024-01-15T17:00:00.000Z",
        "created_at": "2023-10-27T10:00:00.000Z",
        "updated_at": "2023-10-27T10:00:00.000Z",
        "teacher_name": "Mr. Smith"
      }
    ]
  }
  ```

---

### 3. Update an Assignment

Updates the details of an existing assignment. Only the teacher who created the assignment can update it.

- **Method**: `PUT`
- **URL**: `/api/assignments/:id`
- **Access**: `Teacher`
- **Body (JSON)**:

| Field      | Type     | Description                         | Required |
| ---------- | -------- | ----------------------------------- | -------- |
| `title`    | `String` | The new title for the assignment.   | No       |
| `subject`  | `String` | The new subject for the assignment. | No       |
| `due_date` | `String` | The new submission deadline.        | No       |
| `details`  | `String` | The new detailed description.       | No       |

- **`curl` Example**:

  ```bash
  curl -X PUT http://localhost:3000/api/assignments/existing-assignment-uuid \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_TEACHER_JWT_TOKEN" \
  -d '{
    "title": "Final Chapter 5 Problems",
    "due_date": "2024-01-16 17:00:00"
  }'
  ```

- **Success Response (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Assignment updated successfully."
  }
  ```

- **Error Responses**:
  - `403 Forbidden`: If the user is not the teacher who created the assignment.
  - `404 Not Found`: If no assignment is found with the given ID.

---

### 4. Delete an Assignment

Deletes an existing assignment. Only the teacher who created the assignment can delete it.

- **Method**: `DELETE`
- **URL**: `/api/assignments/:id`
- **Access**: `Teacher`
- **`curl` Example**:

  ```bash
  curl -X DELETE http://localhost:3000/api/assignments/existing-assignment-uuid \
  -H "x-auth-token: YOUR_TEACHER_JWT_TOKEN"
  ```

- **Success Response (`200 OK`)**:

  ```json
  {
    "success": true,
    "message": "Assignment deleted successfully."
  }
  ```

- **Error Responses**:
  - `403 Forbidden`: If the user is not the teacher who created the assignment.
  - `404 Not Found`: If no assignment is found with the given ID.
