# Frontend Integration Guide: Exams & Results

This document provides detailed instructions for frontend developers on how to integrate with the backend API for managing and taking exams, as well as viewing results.

**Base URL:** All API endpoints described below are prefixed with the application's base URL (e.g., `http://localhost:3000`).

**Authentication:** All private endpoints require a JSON Web Token (JWT) to be passed in the `x-auth-token` header of the request. The token is obtained upon successful login.

```javascript
// Example of making an authenticated request using fetch

async function fetchData(endpoint, options = {}) {
  const token = localStorage.getItem('authToken'); // Or wherever you store the JWT

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['x-auth-token'] = token;
  }

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'An error occurred');
  }

  return response.json();
}
```

---

## 1. Admin & Super Admin Endpoints

These endpoints are for managing exams and are restricted to users with `Admin` or `SuperAdmin` roles.

### 1.1. Create a New Exam

Creates a new exam with its subjects and questions.

*   **Endpoint:** `POST /api/exams/store`
*   **Access:** `Admin`, `SuperAdmin`
*   **Request Body:**

    ```json
    {
      "examType": "Internal" | "External",
      "subjectType": "Single" | "Multiple",
      "title": "Mid-Term Entrance Examination",
      "prospectiveClass": "JSS 1",
      "dateTime": "2024-09-15T10:00:00Z",
      "duration": 2.5, // Duration in hours
      "subjects": [
        {
          "title": "Mathematics",
          "questions": [
            {
              "text": "What is 2 + 2?",
              "options": ["3", "4", "5", "6"],
              "correctAnswerIndex": 1
            },
            {
              "text": "What is the square root of 16?",
              "options": ["2", "4", "8", "16"],
              "correctAnswerIndex": 1
            }
          ]
        },
        {
          "title": "English Language",
          "questions": [
            // ... questions
          ]
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function createExam(examData) {
      try {
        const result = await fetchData('/exams/store', {
          method: 'POST',
          body: JSON.stringify(examData),
        });
        console.log('Exam created:', result.data);
        return result;
      } catch (error) {
        console.error('Failed to create exam:', error.message);
      }
    }

    // Usage:
    const newExam = { /* ... exam data from above ... */ };
    createExam(newExam);
    ```

### 1.2. Get All Exams

Fetches a list of all exams. Admins see exams for their branch, while Super Admins see exams for all branches.

*   **Endpoint:** `GET /api/exams`
*   **Access:** `Admin`, `SuperAdmin`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "id": "exam_uuid_123",
          "exam_title": "Mid-Term Entrance Examination",
          "exam_type": "Internal",
          "exam_class": "JSS 1",
          "subject_type": "Multiple",
          "exam_date_time": "2024-09-15T10:00:00Z",
          "branch": "Main Campus",
          "exam_duration": 2.5
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getAllExams() {
      try {
        const result = await fetchData('/exams');
        console.log('Available exams:', result.data);
        return result.data;
      } catch (error) {
        console.error('Failed to fetch exams:', error.message);
      }
    }
    ```

### 1.3. Update an Exam

Updates the details of an existing exam. Note: This does not update subjects or questions.

*   **Endpoint:** `PUT /api/exams/:examId`
*   **Access:** `Admin`, `SuperAdmin`
*   **Request Body:**

    ```json
    {
      "title": "Updated Mid-Term Exam Title",
      "examType": "Internal",
      "dateTime": "2024-09-16T10:00:00Z",
      "duration": 3
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function updateExam(examId, updateData) {
      try {
        const result = await fetchData(`/exams/${examId}`, {
          method: 'PUT',
          body: JSON.stringify(updateData),
        });
        console.log('Exam updated:', result.message);
        return result;
      } catch (error) {
        console.error('Failed to update exam:', error.message);
      }
    }
    ```

### 1.4. Delete an Exam

Deletes an exam and all its associated subjects and questions.

*   **Endpoint:** `DELETE /api/exams/:examId`
*   **Access:** `Admin`, `SuperAdmin`
*   **JavaScript Example:**

    ```javascript
    async function deleteExam(examId) {
      try {
        const result = await fetchData(`/exams/${examId}`, {
          method: 'DELETE',
        });
        console.log(result.message); // "Exam deleted successfully."
        return result;
      } catch (error) {
        console.error('Failed to delete exam:', error.message);
      }
    }
    ```

---

## 2. Teacher Endpoints

These endpoints are for teachers to manage exams and results for their assigned class.

### 2.1. Get Exams for Teacher's Class

Fetches all exams scheduled for the authenticated teacher's assigned class.

*   **Endpoint:** `GET /api/exams/class`
*   **Access:** `Teacher`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "id": "exam_uuid_456",
          "title": "First Term Mathematics",
          "exam_type": "Internal",
          // ... other exam details
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getTeacherExams() {
      try {
        const result = await fetchData('/exams/class');
        console.log("Exams for your class:", result.data);
        return result.data;
      } catch (error) {
        console.error("Failed to fetch teacher's exams:", error.message);
      }
    }
    ```

### 2.2. Get Exam Results for a Class

Fetches the results for all students in the teacher's class for a specific exam.

*   **Endpoint:** `GET /api/exams/:examId/results/teacher`
*   **Access:** `Teacher`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "id": "result_uuid_789",
          "score": 85.5,
          "total_questions": 50,
          "answered_questions": 48,
          "submitted_at": "2024-09-15T12:30:00Z",
          "published": false,
          "first_name": "John",
          "last_name": "Doe"
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getClassResults(examId) {
      try {
        const result = await fetchData(`/exams/${examId}/results/teacher`);
        console.log('Class results:', result.data);
        return result.data;
      } catch (error) {
        console.error('Failed to fetch class results:', error.message);
      }
    }
    ```

### 2.3. Publish Exam Results

Publishes the results for a specific exam for the teacher's entire class, making them visible to students and parents.

*   **Endpoint:** `PUT /api/exams/results/publish`
*   **Access:** `Teacher`
*   **Request Body:**

    ```json
    {
      "exam_id": "exam_uuid_456",
      "class_id": "class_uuid_abc"
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function publishResults(examId, classId) {
      try {
        const result = await fetchData('/exams/results/publish', {
          method: 'PUT',
          body: JSON.stringify({ exam_id: examId, class_id: classId }),
        });
        console.log(result.message); // "Results published successfully."
        return result;
      } catch (error) {
        console.error('Failed to publish results:', error.message);
      }
    }
    ```
---

## 3. Student & Parent Endpoints

These endpoints are for students and parents to view exam-related information.

### 3.1. Get Upcoming Exams (Public)

Fetches a list of all upcoming exams across all branches. This is a public endpoint and does not require authentication.

*   **Endpoint:** `GET /api/exams/upcoming`
*   **Access:** `Public`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "title": "Entrance Exam 2025",
          "date": "2025-08-01T09:00:00Z",
          "class": "JSS 1",
          "branch": "Main Campus",
          "subjects": ["Mathematics", "English", "General Knowledge"]
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getPublicUpcomingExams() {
      try {
        // No token needed for public endpoints
        const response = await fetch('/api/exams/upcoming');
        const result = await response.json();
        console.log("Upcoming exams:", result.data);
        return result.data;
      } catch (error) {
        console.error("Failed to fetch upcoming exams:", error.message);
      }
    }
    ```

### 3.2. Get My Upcoming Exams (Authenticated)

Fetches upcoming exams relevant to the authenticated user (Student, Parent, or Teacher). For example, a parent sees exams for all their children.

*   **Endpoint:** `GET /api/exams/me/upcoming`
*   **Access:** `Student`, `NewStudent`, `Parent`, `Teacher`
*   **JavaScript Example:**

    ```javascript
    async function getMyUpcomingExams() {
      try {
        const result = await fetchData('/exams/me/upcoming');
        console.log("My upcoming exams:", result.data);
        return result.data;
      } catch (error) {
        console.error("Failed to fetch my upcoming exams:", error.message);
      }
    }
    ```
---

## 4. Computer-Based Testing (CBT) Flow for Students

This section outlines the sequence of API calls a student (`Student` or `NewStudent`) must make to take an exam.

### Step 1: Fetch Exam Subjects

First, the student fetches the subjects for their upcoming exam. This tells the frontend which subjects are part of the exam and provides their IDs.

*   **Endpoint:** `GET /api/exams/subjects`
*   **Access:** `Student`, `NewStudent`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "id": "subject_uuid_abc",
          "title": "Mathematics",
          "exam_id": "exam_uuid_456",
          "exam_duration": 2.5
        },
        {
          "id": "subject_uuid_def",
          "title": "English Language",
          "exam_id": "exam_uuid_456",
          "exam_duration": 2.5
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getExamSubjects() {
      try {
        const result = await fetchData('/exams/subjects');
        console.log("Exam subjects:", result.data);
        // UI can now display these subjects to the student
        return result.data;
      } catch (error) {
        console.error("Failed to fetch exam subjects:", error.message);
      }
    }
    ```

### Step 2: Fetch Questions for a Subject

Once the student is ready to start (or continue) a subject, the frontend fetches the questions for that specific subject using its ID.

**Important:** Questions can only be fetched within a specific time window: starting 30 minutes before the exam's official start time and ending when the exam duration is over.

*   **Endpoint:** `GET /api/exams/subjects/:subjectId/questions`
*   **Access:** `Student`, `NewStudent`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "id": "question_uuid_1",
          "text": "What is 2 + 2?",
          "options": "[\"3\",\"4\",\"5\",\"6\"]" // Note: Options are a JSON string
        },
        {
          "id": "question_uuid_2",
          "text": "What is the square root of 16?",
          "options": "[\"2\",\"4\",\"8\",\"16\"]"
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getSubjectQuestions(subjectId) {
      try {
        const result = await fetchData(`/exams/subjects/${subjectId}/questions`);
        // Remember to parse the `options` string for each question
        const questions = result.data.map(q => ({
          ...q,
          options: JSON.parse(q.options)
        }));
        console.log("Questions for subject:", questions);
        return questions;
      } catch (error) {
        // Handle specific errors, e.g., "It is not yet time for the exam."
        console.error(`Failed to fetch questions:`, error.message);
      }
    }
    ```

### Step 3: Submit Answers

After the student completes the exam (or a subject), the frontend submits all their answers in a single request. The request should be an array of answer objects.

*   **Endpoint:** `POST /api/exams/answers`
*   **Access:** `Student`, `NewStudent`
*   **Request Body:**

    ```json
    {
      "answers": [
        {
          "question_id": "question_uuid_1",
          "selected_option_index": 1
        },
        {
          "question_id": "question_uuid_2",
          "selected_option_index": 1
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function submitExamAnswers(answers) {
      try {
        const result = await fetchData('/exams/answers', {
          method: 'POST',
          body: JSON.stringify({ answers }),
        });
        console.log(result.message); // "Exam submitted successfully."
        return result;
      } catch (error) {
        // Handle specific errors, e.g., "You have already submitted answers for this exam."
        console.error('Failed to submit answers:', error.message);
      }
    }
    ```
---

## 5. Viewing Personal Exam Results

This section is for students to view their own published results.

### 5.1. Get My Published Results

Fetches all *published* exam results for the authenticated student for the current active term. Results will only appear here after a teacher has published them.

*   **Endpoint:** `GET /api/exams/results/me`
*   **Access:** `Student`
*   **Success Response (`200 OK`):**

    ```json
    {
      "success": true,
      "data": [
        {
          "id": "result_uuid_xyz",
          "score": 95.0,
          "total_questions": 40,
          "answered_questions": 40,
          "submitted_at": "2024-09-20T11:00:00Z",
          "exam_title": "Final Term English",
          "exam_date_time": "2024-09-20T09:00:00Z"
        }
      ]
    }
    ```

*   **JavaScript Example:**

    ```javascript
    async function getMyResults() {
      try {
        const result = await fetchData('/exams/results/me');
        console.log("My published results:", result.data);
        return result.data;
      } catch (error) {
        console.error("Failed to fetch my results:", error.message);
      }
    }
    ```
