# Staff Management API Documentation

## Base URL

`/api/staff`

## Authentication

All endpoints require authentication via JWT token in the `x-auth-token` header.

## Authorization

- **SuperAdmin** and **Admin** roles can: create, update, terminate, suspend staff, and reset passwords
- **SuperAdmin** only can: permanently delete staff
- All authenticated users can: view staff lists and details

---

## Endpoints

### 1. Create Staff Member

**POST** `/api/staff/create`

**Authorization Required:** SuperAdmin, Admin

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john.doe@school.com",
  "phone": "+1234567890",
  "address": "123 Main St, City, State",
  "salary": 50000,
  "salary_type": "monthly",
  "gender": "male",
  "description": "Mathematics teacher with 5 years experience",
  "role_id": 3,
  "branch_id": "uuid-branch-id",
  "image": "https://firebase-storage-url/image.jpg"
}
```

**Required Fields:**

- `name` (string)
- `email` (string) - Must be unique
- `phone` (string)
- `gender` (string) - Must be: "male", "female", or "other"
- `role_id` (number) - Must be valid role ID from roles table
- `branch_id` (string) - Must be valid branch UUID

**Optional Fields:**

- `address` (string)
- `salary` (number) - Must be positive if provided
- `salary_type` (string) - Must be "monthly" or "hourly", defaults to "monthly"
- `description` (string)
- `image` (string) - Firebase storage URL

**Success Response (201):**

```json
{
  "success": true,
  "message": "Staff member created successfully",
  "data": {
    "id": "generated-uuid",
    "name": "John Doe",
    "email": "john.doe@school.com",
    "phone": "+1234567890",
    "branch": "Main Branch",
    "branchId": "uuid-branch-id",
    "role": "Teacher",
    "roleId": 3,
    "salary": 50000,
    "salary_type": "monthly",
    "status": "Active",
    "description": "Mathematics teacher with 5 years experience",
    "imageUrl": "https://firebase-storage-url/image.jpg",
    "address": "123 Main St, City, State",
    "gender": "Male",
    "salaryDueDate": "2024-02-15",
    "temporaryPassword": "xY3#mN9@kL"
  }
}
```

---

### 2. Get All Staff Members

**GET** `/api/staff`

**Authorization Required:** Any authenticated user

**Success Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "John Doe",
      "email": "john.doe@school.com",
      "phone": "+1234567890",
      "branch": "Main Branch",
      "branchId": "uuid-branch-id",
      "role": "Teacher",
      "roleId": 3,
      "salary": 50000,
      "salary_type": "monthly",
      "status": "Active",
      "description": "Mathematics teacher",
      "imageUrl": "https://firebase-storage-url/image.jpg",
      "address": "123 Main St",
      "gender": "Male",
      "salaryDueDate": "2024-02-15",
      "createdAt": "2024-01-01T10:00:00Z"
    }
  ]
}
```

---

### 3. Get Single Staff Member

**GET** `/api/staff/:id`

**Authorization Required:** Any authenticated user

**URL Parameters:**

- `id` - Staff member UUID

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john.doe@school.com",
    "phone": "+1234567890",
    "branch": "Main Branch",
    "branchId": "uuid-branch-id",
    "role": "Teacher",
    "roleId": 3,
    "salary": 50000,
    "salary_type": "monthly",
    "status": "Active",
    "description": "Mathematics teacher",
    "imageUrl": "https://firebase-storage-url/image.jpg",
    "address": "123 Main St",
    "gender": "Male",
    "salaryDueDate": "2024-02-15",
    "createdAt": "2024-01-01T10:00:00Z"
  }
}
```

---

### 4. Update Staff Member

**PUT** `/api/staff/:id/update`

**Authorization Required:** SuperAdmin, Admin

**URL Parameters:**

- `id` - Staff member UUID

**Request Body:** (All fields are optional)

```json
{
  "name": "John Smith",
  "email": "john.smith@school.com",
  "phone": "+0987654321",
  "address": "456 Oak Ave",
  "salary": 55000,
  "salary_type": "monthly",
  "gender": "male",
  "description": "Senior Mathematics teacher",
  "role_id": 3,
  "branch_id": "new-branch-uuid",
  "image": "https://new-firebase-url/image.jpg"
}
```

**Success Response (200):**

```json
{
  "success": true,
  "message": "Staff member updated successfully",
  "data": {
    "id": "uuid",
    "name": "John Smith",
    "email": "john.smith@school.com",
    "phone": "+0987654321",
    "branch": "New Branch",
    "branchId": "new-branch-uuid",
    "role": "Teacher",
    "roleId": 3,
    "salary": 55000,
    "salary_type": "monthly",
    "status": "Active",
    "description": "Senior Mathematics teacher",
    "imageUrl": "https://new-firebase-url/image.jpg",
    "address": "456 Oak Ave",
    "gender": "Male",
    "salaryDueDate": "2024-02-15"
  }
}
```

---

### 5. Update Staff Status

**PATCH** `/api/staff/:id/status`

**Authorization Required:** SuperAdmin, Admin

**URL Parameters:**

- `id` - Staff member UUID

**Request Body:**

```json
{
  "status": "Suspended"
}
```

**Valid Status Values:**

- `Active`
- `On Leave`
- `Not Paid`
- `Suspended`
- `Terminated`

**Success Response (200):**

```json
{
  "success": true,
  "message": "Staff member suspended successfully",
  "data": {
    "id": "uuid",
    "status": "Suspended"
  }
}
```

---

### 6. Reset Staff Password

**POST** `/api/staff/:id/reset-password`

**Authorization Required:** SuperAdmin, Admin

**URL Parameters:**

- `id` - Staff member UUID

**Success Response (200):**

```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": {
    "id": "uuid",
    "email": "john.doe@school.com",
    "name": "John Doe",
    "temporaryPassword": "nB7#kL2@pQ"
  }
}
```

---

### 7. Delete Staff Member (Permanent)

**DELETE** `/api/staff/:id`

**Authorization Required:** SuperAdmin only

**URL Parameters:**

- `id` - Staff member UUID

**Success Response (200):**

```json
{
  "success": true,
  "message": "Staff member deleted successfully"
}
```

---

### 8. Get Staff by Branch

**GET** `/api/staff/branch/:branchId`

**Authorization Required:** Any authenticated user

**URL Parameters:**

- `branchId` - Branch UUID

**Success Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "John Doe",
      "email": "john.doe@school.com",
      "phone": "+1234567890",
      "branch": "Main Branch",
      "branchId": "uuid-branch-id",
      "role": "Teacher",
      "roleId": 3,
      "salary": 50000,
      "salary_type": "monthly",
      "status": "Active",
      "description": "Mathematics teacher",
      "imageUrl": "https://firebase-storage-url/image.jpg",
      "address": "123 Main St",
      "gender": "Male",
      "salaryDueDate": "2024-02-15"
    }
  ]
}
```

---

### 9. Get Staff by Status

**GET** `/api/staff/status/:status`

**Authorization Required:** Any authenticated user

**URL Parameters:**

- `status` - One of: Active, On Leave, Not Paid, Suspended, Terminated

**Success Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "John Doe",
      "email": "john.doe@school.com",
      "phone": "+1234567890",
      "branch": "Main Branch",
      "branchId": "uuid-branch-id",
      "role": "Teacher",
      "roleId": 3,
      "salary": 50000,
      "salary_type": "monthly",
      "status": "Active",
      "description": "Mathematics teacher",
      "imageUrl": "https://firebase-storage-url/image.jpg",
      "address": "123 Main St",
      "gender": "Male",
      "salaryDueDate": "2024-02-15"
    }
  ]
}
```

---

## Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "message": "Error description"
}
```

### 401 Unauthorized

```json
{
  "message": "No token, authorization denied"
}
```

### 403 Forbidden

```json
{
  "message": "Access denied. Insufficient permissions."
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "Staff member not found"
}
```

### 500 Server Error

```json
{
  "success": false,
  "message": "Server error while processing request"
}
```

---

## Important Notes

1. **Role IDs**: Make sure to use valid role IDs from your roles table:

   - Teacher: 3
   - Admin: 5
   - NonTeachingStaff: 7
   - Other roles as defined in your database

2. **Password Generation**: When creating a staff member or resetting their password, a temporary password is automatically generated. This password should be provided to the staff member for their first login.

3. **Salary Management**:

   - `salary` must be a positive number if provided
   - `salary_type` can be either "monthly" or "hourly" (defaults to "monthly")
   - `salaryDueDate` is automatically calculated as 30 days from creation when a salary is provided

4. **Email Uniqueness**: Email addresses must be unique across the entire system.

5. **Status Management**: Use the status endpoints to manage staff lifecycle (active, suspended, terminated, etc.)

6. **Branch IDs**: Use valid branch UUIDs from your branches table.

7. **Gender Values**: Always use lowercase: "male", "female", or "other"
