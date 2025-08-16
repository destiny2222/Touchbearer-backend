# Staff Management API - CURL Examples

## Prerequisites

First, you need to login to get an authentication token:

```bash
# Login as SuperAdmin or Admin to get auth token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@school.com",
    "password": "your_password"
  }'
```

Response will include a token:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "message": "Login successful"
}
```

Use this token in the `x-auth-token` header for all subsequent requests.

---

## 1. Create a New Staff Member

```bash
curl -X POST http://localhost:3000/api/staff/create \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE" \
  -d '{
    "name": "Sarah Johnson",
    "email": "sarah.johnson@school.com",
    "phone": "+1234567890",
    "address": "123 Education Lane, Boston, MA 02134",
    "teacher_salary": 55000,
    "gender": "female",
    "description": "Experienced Math Teacher with PhD in Mathematics",
    "role_id": 3,
    "branch_id": "branch-uuid-here",
    "image": "https://firebasestorage.googleapis.com/v0/b/your-app.appspot.com/o/staff%2Fsarah.jpg"
  }'
```

**Success Response:**

```json
{
  "success": true,
  "message": "Staff member created successfully",
  "data": {
    "id": "generated-staff-uuid",
    "name": "Sarah Johnson",
    "email": "sarah.johnson@school.com",
    "phone": "+1234567890",
    "branch": "Main Campus",
    "branchId": "branch-uuid-here",
    "role": "Teacher",
    "roleId": 3,
    "teacher_salary": 55000,
    "status": "Active",
    "description": "Experienced Math Teacher with PhD in Mathematics",
    "imageUrl": "https://firebasestorage.googleapis.com/v0/b/your-app.appspot.com/o/staff%2Fsarah.jpg",
    "address": "123 Education Lane, Boston, MA 02134",
    "gender": "Female",
    "salaryDueDate": "2024-02-15",
    "temporaryPassword": "xY3#mN9@kL"
  }
}
```

---

## 2. Get All Staff Members

```bash
curl -X GET http://localhost:3000/api/staff \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

---

## 3. Get Single Staff Member

```bash
curl -X GET http://localhost:3000/api/staff/staff-uuid-here \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

---

## 4. Update Staff Member

```bash
curl -X PUT http://localhost:3000/api/staff/staff-uuid-here/update \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE" \
  -d '{
    "name": "Sarah Johnson-Smith",
    "teacher_salary": 60000,
    "description": "Senior Math Teacher and Department Head"
  }'
```

---

## 5. Suspend a Staff Member

```bash
curl -X POST http://localhost:3000/api/staff/staff-uuid-here/suspend \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

---

## 6. Terminate a Staff Member

```bash
curl -X POST http://localhost:3000/api/staff/staff-uuid-here/terminate \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

---

## 7. Update Staff Status (Generic)

```bash
curl -X PATCH http://localhost:3000/api/staff/staff-uuid-here/status \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE" \
  -d '{
    "status": "On Leave"
  }'
```

---

## 8. Reset Staff Password

```bash
curl -X POST http://localhost:3000/api/staff/staff-uuid-here/reset-password \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

**Response includes new temporary password:**

```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": {
    "id": "staff-uuid-here",
    "email": "sarah.johnson@school.com",
    "name": "Sarah Johnson",
    "temporaryPassword": "nB7#kL2@pQ"
  }
}
```

---

## 9. Get Staff by Branch

```bash
curl -X GET http://localhost:3000/api/staff/branch/branch-uuid-here \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

---

## 10. Get Staff by Status

```bash
curl -X GET http://localhost:3000/api/staff/status/Active \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

---

## 11. Delete Staff Member (SuperAdmin Only)

```bash
curl -X DELETE http://localhost:3000/api/staff/staff-uuid-here \
  -H "x-auth-token: YOUR_JWT_TOKEN_HERE"
```

## Available Role IDs

- Teacher: 3
- Admin: 5
- NonTeacheringStaff: 7

## Valid Status Values

- Active
- On Leave
- Not Paid
- Suspended
- Terminated

## Notes

1. Replace `YOUR_JWT_TOKEN_HERE` with the actual token from login
2. Replace `staff-uuid-here` with actual staff IDs
3. Replace `branch-uuid-here` with actual branch IDs from your database
4. The `temporaryPassword` returned when creating staff should be given to the staff member
5. All dates are in ISO format (YYYY-MM-DD)
6. Gender must be lowercase: "male", "female", or "other"
