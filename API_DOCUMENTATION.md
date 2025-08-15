# API Documentation

## Authentication

To access protected routes, you need to include the JWT in the `x-auth-token` header of your request.

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
    "id": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "image": "string"
  },
  "token": "string",
  "message": "Login successful"
}
```

**Failure Response:**

```json
{
  "message": "Invalid credentials"
}
```

**Frontend Integration Example:**

```javascript
const login = async (email, password) => {
  try {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    console.log(data);
    // Save the token to localStorage or a cookie
    localStorage.setItem('token', data.token);
  } catch (error) {
    console.error('Error:', error);
  }
};
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

## Branch Management

### Get All Branches

**Endpoint:** `GET /api/branches`

**Description:** Retrieves a list of all branches.

**Success Response:**

```json
[
  {
    "id": "string",
    "school_name": "string",
    "address": "string",
    "email": "string",
    "basic_education": ["string", "string"],
    "is_active": 1,
    "created_at": "string"
  }
]
```

### Create New Branch (SuperAdmin only)

**Endpoint:** `POST /api/branches/store`

**Description:** Creates a new branch. This endpoint can only be accessed by a SuperAdmin.

**Request Body:**

```json
{
  "school_name": "string",
  "address": "string",
  "admin-email": "string",
  "basic_education": ["string", "string"],
  "is_active": 1
}
```

**Success Response:**

```json
{
  "message": "Branch created"
}
```

**Error Response:**

```json
{
  "message": "Please enter all fields"
}
```

### Update an Existing Branch (SuperAdmin only)

**Endpoint:** `PUT /api/branches/{branchId}/update`

**Description:** Updates an existing branch. This endpoint can only be accessed by a SuperAdmin.

**Request Body:**

```json
{
  "id": "string",
  "school_name": "string",
  "admin-address": "string",
  "email": "string",
  "basic_education": ["string", "string"],
  "is_active": 1
}
```

**Success Response:**

```json
{
  "message": "Branch updated"
}
```

**Error Response:**

```json
{
  "message": "Please enter all fields"
}
```

### Delete a Branch (SuperAdmin only)

**Endpoint:** `DELETE /api/branches/{id}`

**Description:** Deletes a branch. This endpoint can only be accessed by a SuperAdmin.

**Success Response:**

```json
{
  "message": "Branch deleted"
}
```

**Error Response:**

```json
{
  "message": "Server error"
}
```

**Frontend Integration Example:**

```javascript
const registerStudent = async (studentData) => {
  try {
    const response = await fetch('http://localhost:3000/api/auth/register/student', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(studentData)
    });
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error('Error:', error);
  }
};
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
