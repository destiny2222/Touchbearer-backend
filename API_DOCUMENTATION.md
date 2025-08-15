# API Documentation

## Authentication

### Admin Login

**Endpoint:** `POST /api/auth/login`

**Description:** Authenticates an admin user and returns a JSON Web Token (JWT).

**Request Body:**

```json
{
  "email": "admin@gmail.com",
  "password": "whoami"
}
```

**Success Response:**

```json
{
  "admin": {
    "id": 1,
    "name": "Super Admin Name",
    "email": "admin@example.com",
    "phone": "123-456-7890",
    "image": "https://example.com/path/to/image.jpg"
  },
  "token": "your_authentication_token_string",
  "message": "Login successful"
}
```

**Error Response:**

```json
{
  "message": "Invalid credentials"
}
```

### New Student Registration

**Endpoint:** `POST /api/auth/register/student`

**Description:** Registers a new student and creates a user account for them.

**Request Body:**

```json
{
  "first_name": "string",
  "last_name": "string",
  "dob": "string",
  "passport": "string",
  "address": "string",
  "nationality": "string",
  "state": "string",
  "class_applying": "string",
  "branch_id": "string",
  "previous_school": "string",
  "religion": "string",
  "disability": "string",
  "parent_name": "string",
  "parent_phone": "string",
  "parent_email": "string",
  "score": "number",
  "payment_status": "string"
}
```

**Success Response:**

```json
{
  "message": "Student registered successfully",
  "password": "generated_password"
}
```

**Error Response:**

```json
{
  "message": "Please enter all required fields"
}
```

```json
{
  "message": "Email already exists"
}
```

### Create New User (SuperAdmin only)

**Endpoint:** `POST /api/auth/register`

**Description:** Creates a new user with a specified role. This endpoint can only be accessed by a SuperAdmin.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "user_password",
  "role": "Teacher"
}
```

**Success Response:**

```json
{
  "message": "User registered"
}
```

**Error Response:**

```json
{
  "message": "Please enter all fields"
}
```

```json
{
  "message": "Email already exists"
}
```

```json
{
  "message": "Invalid role"
}
```

```json
{
  "message": "Access denied"
}
```

### Create SuperAdmin

**Endpoint:** `POST /api/superadmin/register`

**Description:** Creates a new SuperAdmin user.

**Request Body:**

```json
{
  "email": "superadmin@example.com",
  "password": "superadmin_password",
  "name": "Super Admin Name",
  "phone": "123-456-7890",
  "image": "https://example.com/path/to/image.jpg"
}
```

**Success Response:**

```json
{
  "message": "SuperAdmin registered"
}
```

**Error Response:**

```json
{
  "message": "Please enter all fields"
}
```

```json
{
  "message": "Email already exists"
}
```
