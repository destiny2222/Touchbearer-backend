# Exam API Documentation - Flexible Exam Timing Update

## Overview
This document outlines the changes to exam endpoints to support flexible timing for external exams (e.g., entrance exams).

---

## New Database Fields

### exams table
| Field | Type | Description |
|-------|------|-------------|
| `exam_end_datetime` | DATETIME (nullable) | End of the exam window for external exams. If null, uses original fixed timing. |

### exam_results table
| Field | Type | Description |
|-------|------|-------------|
| `started_at` | DATETIME (nullable) | Timestamp when student first accessed the exam |
| `time_spent_minutes` | INT (nullable) | Actual time spent by student on the exam |

---

## API Endpoints

### 1. POST /api/exams/store
**Purpose:** Create a new exam

**Request Body:**
```json
{
  "examType": "External", // or "Internal"
  "assessment_type": "exam", // required for Internal exams
  "subjectType": "Single-Subject" or "Multi-Subject",
  "title": "Exam Title",
  "class_id": "uuid",
  "dateTime": "2026-05-10T09:00:00", // ISO datetime
  "duration_minutes": 60,
  "exam_end_datetime": "2026-05-15T18:00:00", // OPTIONAL - for external exams only
  "subjects": [
    {
      "class_subject_id": "uuid",
      "questions": [
        {
          "text": "Question text",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswerIndex": 0
        }
      ]
    }
  ]
}
```

**Validation:**
- If `exam_end_datetime` is provided, it must be after `exam_date_time`

**Response:**
```json
{
  "success": true,
  "message": "Exam created successfully.",
  "data": {
    "id": "uuid",
    "title": "Exam Title",
    "exam_type": "External",
    "exam_date_time": "2026-05-10T09:00:00",
    "exam_end_datetime": "2026-05-15T18:00:00", // or null
    "duration_minutes": 60,
    ...
  }
}
```

---

### 2. PUT /api/exams/:examId
**Purpose:** Update an existing exam

**Request Body:**
```json
{
  "title": "Updated Title",
  "examType": "External",
  "dateTime": "2026-05-10T09:00:00",
  "duration_minutes": 60,
  "exam_end_datetime": "2026-05-15T18:00:00" // OPTIONAL
}
```

**Validation:**
- If `exam_end_datetime` is provided, it must be after `exam_date_time`

---

### 3. GET /api/exams/student/current-exam
**Purpose:** Get current exam for student with timing info

**Access:** Student, NewStudent

**Response:**
```json
{
  "success": true,
  "data": {
    "examId": "uuid",
    "title": "Exam Title",
    "examDuration": 60,
    "examStartTime": "2026-05-10T09:00:00",
    "examEndDatetime": "2026-05-15T18:00:00", // null for internal exams
    "startedAt": "2026-05-12T10:30:00", // timestamp when student first accessed
    "remainingTime": 45, // minutes remaining based on started_at + duration
    "subjects": [
      {
        "id": "uuid",
        "title": "Mathematics",
        "questions": [
          {
            "id": "uuid",
            "text": "Question text",
            "question_image_url": null,
            "options": ["A", "B", "C", "D"]
          }
        ]
      }
    ]
  }
}
```

**Behavior:**
- **First access:** Creates `exam_results` entry with `started_at = NOW()`
- **Subsequent access:** Returns `remainingTime` based on `started_at + duration_minutes`
- **If time expired:** Returns 403 with message "Your exam time has expired."

**For External Exams:**
- Allows access between `exam_date_time` and `exam_end_datetime` (if set)
- If no `exam_end_datetime`, uses original logic (duration from exam_date_time)

**For Internal Exams:**
- Unchanged behavior - fixed start time enforcement

---

### 4. POST /api/exams/answers
**Purpose:** Submit exam answers

**Request Body:**
```json
{
  "examId": "uuid",
  "answers": [
    {
      "questionId": "uuid",
      "selectedOptionIndex": 0
    }
  ]
}
```

**Validation:**
1. Student must have started the exam (must have `exam_results` entry with `started_at`)
2. Submission must be within:
   - `started_at + duration_minutes + 5 minutes grace period`
   - AND before `exam_end_datetime` (if set)
3. If either condition fails, returns 403

**Response (Success):**
```json
{
  "success": true,
  "message": "Exam submitted successfully."
}
```

**Response (Error - Already submitted):**
```json
{
  "success": false,
  "message": "You have already submitted answers for this exam."
}
```

**Response (Error - Time expired):**
```json
{
  "success": false,
  "message": "Your exam time has expired. Submission is no longer accepted."
}
```

---

### 5. GET /api/exams/:examId/results
**Purpose:** Get all results for an exam (Admin/SuperAdmin)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "score": 85.5,
      "total_questions": 50,
      "answered_questions": 45,
      "started_at": "2026-05-12T10:30:00",
      "time_spent_minutes": 42,
      "submitted_at": "2026-05-12T11:12:00",
      "published": false,
      "first_name": "John",
      "last_name": "Doe"
    }
  ]
}
```

---

### 6. GET /api/exams/:examId/results/teacher
**Purpose:** Get all results for an exam (Teacher)

**Response:** Same as above

---

### 7. GET /api/exams (Admin)
**Purpose:** Get all exams for branch

**Response includes:**
```json
{
  "data": [
    {
      "id": "uuid",
      "exam_title": "Exam Title",
      "exam_type": "External",
      "exam_date_time": "2026-05-10 09:00",
      "exam_end_datetime": "2026-05-15 18:00", // NEW - may be null
      "exam_duration": 60,
      ...
    }
  ]
}
```

---

### 8. GET /api/exams/class (Teacher)
**Purpose:** Get exams for teacher's class

**Response includes:** `exam_end_datetime`

---

### 9. GET /api/exams/me/upcoming (Student)
**Purpose:** Get student's upcoming exams

**Response includes:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Exam Title",
      "duration_minutes": 60,
      "date": "2026-05-10 09:00:00",
      "exam_end_datetime": "2026-05-15 18:00:00", // NEW - may be null
      "class": "JSS 1",
      "branch": "School Name",
      "subjects": ["Mathematics", "English"]
    }
  ]
}
```

---

## Key Implementation Details

### Flexible Timing Logic

**External Exams:**
- Availability window: `exam_date_time` to `exam_end_datetime` (if set)
- Once started (`started_at` set), student has `duration_minutes` to complete
- Submission deadline: `min(started_at + duration + 5min grace, exam_end_datetime)`

**Internal Exams:**
- Unchanged - fixed start time enforcement
- Access 30 minutes before `exam_date_time`
- Must complete by `exam_date_time + duration_minutes`

### Grace Period
- 5 minutes grace period for network delays
- Applied only to submission, not to question access

### Time Tracking
- `started_at` is set when student first accesses `/student/current-exam`
- Timer persists across sessions (stored in database)
- `time_spent_minutes` calculated as `submitted_at - started_at`

---

## Backward Compatibility
- All new fields are optional (nullable)
- Existing exams work without changes
- If `exam_end_datetime` is null, behavior is unchanged