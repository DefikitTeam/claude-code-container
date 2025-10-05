# API Contracts: Multi-registration support

## 1. POST `/register-user`
- **Purpose**: Create a new registration tied to a GitHub installation.
- **Request Body**
  ```json
  {
    "installationId": "123456",
    "anthropicApiKey": "sk-ant-...",
    "userId": "optional-user-alias",
    "projectLabel": "optional descriptive name"
  }
  ```
- **Responses**
  - `201 Created`
    ```json
    {
      "success": true,
      "userId": "user_xxx",
      "installationId": "123456",
      "existingRegistrations": [
        {
          "userId": "user_prev",
          "projectLabel": "Project Alpha",
          "created": 1700000000000
        }
      ],
      "message": "User registered successfully."
    }
    ```
  - `409 Conflict`
    ```json
    {
      "success": false,
      "error": "installationId and anthropicApiKey are required"
    }
    ```

## 2. GET `/github/repositories`
- **Query Parameters**: `installationId` (required), `userId` (recommended)
- **Behavior**:
  - When both parameters supplied, resolve exact registration.
  - When `userId` omitted and multiple registrations exist, respond with `409 Conflict`:
    ```json
    {
      "success": false,
      "error": "Multiple registrations found for installation",
      "registrations": [
        { "userId": "user_a", "projectLabel": "Project A" },
        { "userId": "user_b", "projectLabel": "Project B" }
      ]
    }
    ```

## 3. GET `/user-config/:userId`
- **Behavior**: Returns decrypted configuration for the specified registration, unchanged except acknowledging the new storage model.

## 4. DELETE `/user-config/:userId`
- **Behavior**: Removes a specific registration and updates the associated installation directory. (If soft delete is preferred, return `isActive=false`.)

## 5. Durable Object Internal Routes
- `POST /register`: Accepts the same payload as today but now stores multiple entries per installation.
- `GET /user-by-installation?installationId=...`: Returns
  ```json
  {
    "installationId": "123456",
    "registrations": [
      { "userId": "user_a", "projectLabel": "Project A", "isActive": true },
      { "userId": "user_b", "projectLabel": null, "isActive": true }
    ]
  }
  ```
- `DELETE /user?userId=...`: Removes the record and prunes the installation index.

## Error Handling Summary
- Missing `userId` on disambiguation-required endpoints → `409 Conflict` with registration list guidance.
- Attempts to register duplicate `userId` values → `409 Conflict` preserving existing data.
- Requests referencing inactive or missing registrations → `404 Not Found` with clarifying message.
