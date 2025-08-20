Of course. Here is the detailed API documentation for the Broadcast Message System, tailored for frontend integration and split by user roles.

---

## API Documentation: Broadcast Message System

This document outlines how to integrate the broadcast message system into the frontend application. The API provides different functionalities based on user roles.

### General Information

#### Authentication

All endpoints require authentication. The user's JWT must be sent in the `x-auth-token` header with every request.

- **Header**: `x-auth-token: <YOUR_JWT_TOKEN>`

---

## For Admin & SuperAdmin Roles

Admins and SuperAdmins have full control over the broadcast system. They can create, manage, and view readership for all messages.

### 1. Create a Broadcast

Creates a new broadcast message. Can be saved as a `'Draft'` or sent immediately by setting the status to `'Sent'`.

- **Endpoint**: `POST /api/broadcasts`
- **Method**: `POST`
- **Permissions**: `Admin`, `SuperAdmin`

**Request Body (JSON):**

```json
{
  "title": "Upcoming PTA Meeting",
  "message": "This is a reminder about the PTA meeting scheduled for this Friday at 6 PM.",
  "status": "Sent", // Or "Draft"
  "tags": ["PTA", "Event", "Urgent"],
  "cc_roles": ["Parent", "Teacher"]
}
```

**cURL Example:**

```bash
curl -X POST http://localhost:3000/api/broadcasts \
  -H "x-auth-token: <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "Upcoming PTA Meeting",
        "message": "This is a reminder...",
        "status": "Sent",
        "tags": ["PTA", "Event"],
        "cc_roles": ["Parent", "Teacher"]
      }'
```

### 2. Update a Broadcast

Edits an existing broadcast message, its tags, or CC list.

- **Endpoint**: `PUT /api/broadcasts/:id`
- **Method**: `PUT`
- **Permissions**: `Admin`, `SuperAdmin`

**cURL Example:**

```bash
curl -X PUT http://localhost:3000/api/broadcasts/<BROADCAST_ID> \
  -H "x-auth-token: <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "Updated: PTA Meeting Time Changed",
        "status": "Sent"
      }'
```

### 3. Delete a Broadcast

Permanently removes a broadcast and all its associated data.

- **Endpoint**: `DELETE /api/broadcasts/:id`
- **Method**: `DELETE`
- **Permissions**: `Admin`, `SuperAdmin`

**cURL Example:**

```bash
curl -X DELETE http://localhost:3000/api/broadcasts/<BROADCAST_ID> \
  -H "x-auth-token: <ADMIN_JWT_TOKEN>"
```

### 4. Get All Broadcasts

Retrieves a paginated list of all broadcasts (both `'Draft'` and `'Sent'`). Includes the Admin's own read status for each message.

- **Endpoint**: `GET /api/broadcasts`
- **Method**: `GET`
- **Permissions**: `Admin`, `SuperAdmin`
- **Query Parameters**:
  - `page` (optional, default: 1)
  - `limit` (optional, default: 20)
  - `tag` (optional, e.g., `?tag=Urgent`)

**cURL Example:**

```bash
# Get page 1 of broadcasts tagged as 'Urgent'
curl -X GET "http://localhost:3000/api/broadcasts?page=1&limit=10&tag=Urgent" \
  -H "x-auth-token: <ADMIN_JWT_TOKEN>"
```

### 5. Get Read Receipts for a Broadcast

Fetches a list of all users and their readership status (`'Read'` or `'Unread'`) for a specific broadcast.

- **Endpoint**: `GET /api/broadcasts/:id/receipts`
- **Method**: `GET`
- **Permissions**: `Admin`, `SuperAdmin`

**cURL Example:**

```bash
curl -X GET http://localhost:3000/api/broadcasts/<BROADCAST_ID>/receipts \
  -H "x-auth-token: <ADMIN_JWT_TOKEN>"
```

**Example Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "user-id-123",
      "email": "user1@example.com",
      "status": "Read",
      "read_at": "2023-10-27T14:00:00.000Z"
    },
    {
      "id": "user-id-456",
      "email": "user2@example.com",
      "status": "Unread",
      "read_at": null
    }
  ]
}
```

---

## For Teacher, Student, Parent & Other Roles

These roles have read-only access to broadcasts relevant to them.

### 1. View Broadcasts

Retrieves a paginated list of `'Sent'` broadcasts that have been addressed to the user's role. Each broadcast includes a `read_status` field.

- **Endpoint**: `GET /api/broadcasts`
- **Method**: `GET`
- **Permissions**: `Teacher`, `Student`, `Parent`, `NonTeachingStaff`

**Frontend Integration:**
Use the `read_status` field to visually distinguish between read and unread messages. A value of `'Unread'` can be used to display a notification indicator.

**Example Response Item:**

```json
{
  "id": "broadcast-id-abc",
  "title": "School Holiday Announcement",
  "message": "The school will be closed next Monday.",
  "status": "Sent",
  "created_at": "...",
  "read_status": "Unread", // Can be 'Read' or 'Unread'
  "tags": "Holiday,Notice",
  "cc_roles": "Student,Parent,Teacher"
}
```

**cURL Example:**

```bash
curl -X GET "http://localhost:3000/api/broadcasts?page=1&limit=20" \
  -H "x-auth-token: <USER_JWT_TOKEN>"
```

### 2. View a Single Broadcast

Retrieves the details of a single broadcast. This endpoint should be called when a user clicks on a message to view it.

- **Endpoint**: `GET /api/broadcasts/:id`
- **Method**: `GET`
- **Permissions**: All roles (with authorization checks)

**cURL Example:**

```bash
curl -X GET http://localhost:3000/api/broadcasts/<BROADCAST_ID> \
  -H "x-auth-token: <USER_JWT_TOKEN>"
```

### 3. Mark a Broadcast as Read

Marks a specific broadcast as read for the logged-in user. This should be called when a user opens or views a broadcast for the first time.

- **Endpoint**: `POST /api/broadcasts/:id/read`
- **Method**: `POST`
- **Permissions**: All roles

**Frontend Integration:**
After the user views a message's details, call this endpoint. On success, update the local state of the message to reflect `read_status: 'Read'` to remove any notification indicators without needing to re-fetch the entire list.

**cURL Example:**

```bash
curl -X POST http://localhost:3000/api/broadcasts/<BROADCAST_ID>/read \
  -H "x-auth-token: <USER_JWT_TOKEN>" \
  -H "Content-Type: application/json"
```
