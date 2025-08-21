# Backend API Documentation for Frontend Integration

This document provides instructions and examples for integrating with the School Fees Management and Parent Login backend endpoints. All examples use `curl` for clarity.

**Base URL:** All endpoints are prefixed with the application's base URL (e.g., `http://localhost:3000`).

---

## 1. Authentication

Authentication is handled via JSON Web Tokens (JWT). A successful login provides a token that must be included in the `x-auth-token` header for all subsequent authenticated requests.

### Parent Login

This endpoint allows a parent to log in. On success, it returns the parent's details, a list of their children, and an auth token.

*   **Endpoint:** `POST /api/auth/parent/login`
*   **Request Body:**
    ```json
    {
      "email": "parent@example.com",
      "password": "password123"
    }
    ```
*   **Success Response (`200 OK`):**
    ```json
    {
      "parent": {
        "id": "parent_uuid_123",
        "name": "Test Parent",
        "email": "parent@example.com",
        "phone": "0987654321",
        "children": [
          {
            "id": "child_uuid_456",
            "name": "Test Student"
          }
        ]
      },
      "token": "<JWT_TOKEN>",
      "message": "Login successful"
    }
    ```
*   **`curl` Example:**
    ```bash
    curl -X POST http://localhost:3000/api/auth/parent/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "parent@test.com",
      "password": "password123"
    }'
    ```

### Admin / Super Admin Login

Admins and Super Admins should use the existing staff login endpoint to get their token.

*   **Endpoint:** `POST /api/auth/login/staff`
*   **`curl` Example:**
    ```bash
    curl -X POST http://localhost:3000/api/auth/login/staff \
    -H "Content-Type: application/json" \
    -d '{
      "email": "admin@test.com",
      "password": "password123"
    }'
    ```

---

## 2. Parent Portal Endpoints

These endpoints require a parent's `x-auth-token`.

### Get Fees for Children

Fetches the fee status for all children linked to the logged-in parent for the current active term.

*   **Endpoint:** `GET /api/fees/children`
*   **`curl` Example:**
    ```bash
    curl -X GET http://localhost:3000/api/fees/children \
    -H "x-auth-token: <PARENT_JWT_TOKEN>"
    ```

### Make a Payment

Allows a parent to make a payment for a specific child and term.

*   **Endpoint:** `POST /api/payments`
*   **Request Body:**
    ```json
    {
      "student_id": "<CHILD_ID>",
      "term_id": "<TERM_ID>",
      "amount_paid": 25000.00
    }
    ```
*   **`curl` Example:**
    ```bash
    curl -X POST http://localhost:3000/api/payments \
    -H "Content-Type: application/json" \
    -H "x-auth-token: <PARENT_JWT_TOKEN>" \
    -d '{
      "student_id": "child_uuid_456",
      "term_id": "term_uuid_789",
      "amount_paid": 25000.00
    }'
    ```

### Get Payment History for a Child

Fetches the full payment history for a specific child.

*   **Endpoint:** `GET /api/payments/history/:childId`
*   **`curl` Example:**
    ```bash
    curl -X GET http://localhost:3000/api/payments/history/<CHILD_ID> \
    -H "x-auth-token: <PARENT_JWT_TOKEN>"
    ```

### Get Payment Status for a Child

Fetches the payment status (`Paid` / `Not Paid`) for a specific child for the current active term.

*   **Endpoint:** `GET /api/payments/status/:childId`
*   **`curl` Example:**
    ```bash
    curl -X GET http://localhost:3000/api/payments/status/<CHILD_ID> \
    -H "x-auth-token: <PARENT_JWT_TOKEN>"
    ```

---

## 3. Admin & Super Admin Endpoints

These endpoints require an Admin or Super Admin's `x-auth-token`.

### Create New Academic Term

Creates a new term. For Admins, the term is automatically scoped to their branch. For Super Admins, `branch_id` is optional (if omitted, the term is global).

*   **Endpoint:** `POST /api/terms/new`
*   **Request Body:**
    ```json
    {
      "name": "First Term 2025/2026",
      "start_date": "2025-09-01",
      "end_date": "2025-12-15",
      "branch_id": "<BRANCH_ID>" // Optional for Super Admin
    }
    ```
*   **`curl` Example:**
    ```bash
    curl -X POST http://localhost:3000/api/terms/new \
    -H "Content-Type: application/json" \
    -H "x-auth-token: <ADMIN_JWT_TOKEN>" \
    -d '{
      "name": "First Term 2025/2026",
      "start_date": "2025-09-01",
      "end_date": "2025-12-15",
      "branch_id": "branch_uuid_abc"
    }'
    ```

### Create School Fee

Creates a new fee item (e.g., Tuition, Bus Fee) for a specific class, term, and branch.

*   **Endpoint:** `POST /api/fees`
*   **Request Body:**
    ```json
    {
      "branch_id": "<BRANCH_ID>",
      "class_id": "<CLASS_ID>",
      "term_id": "<TERM_ID>",
      "name": "Tuition Fee",
      "amount": 75000.00,
      "description": "Primary school tuition fee"
    }
    ```
*   **`curl` Example:**
    ```bash
    curl -X POST http://localhost:3000/api/fees \
    -H "Content-Type: application/json" \
    -H "x-auth-token: <ADMIN_JWT_TOKEN>" \
    -d '{
      "branch_id": "branch_uuid_abc",
      "class_id": "class_uuid_def",
      "term_id": "term_uuid_789",
      "name": "Tuition Fee",
      "amount": 75000.00,
      "description": "Primary school tuition fee"
    }'
    ```

### Update School Fee

Updates an existing fee item.

*   **Endpoint:** `PUT /api/fees/:id`
*   **Request Body:**
    ```json
    {
      "name": "Updated Tuition Fee",
      "amount": 80000.00
    }
    ```
*   **`curl` Example:**
    ```bash
    curl -X PUT http://localhost:3000/api/fees/<FEE_ID> \
    -H "Content-Type: application/json" \
    -H "x-auth-token: <ADMIN_JWT_TOKEN>" \
    -d '{
      "name": "Updated Tuition Fee",
      "amount": 80000.00
    }'
    ```

---

## 4. General Endpoint

### Get Fees by Class

Retrieves all fee items for a specific class for the current active term. Accessible by any authenticated user (Parent, Teacher, Admin, etc.).

*   **Endpoint:** `GET /api/fees/class/:classId`
*   **`curl` Example:**
    ```bash
    curl -X GET http://localhost:3000/api/fees/class/<CLASS_ID> \
    -H "x-auth-token: <ANY_AUTH_USER_TOKEN>"
    ```
