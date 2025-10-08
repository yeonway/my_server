# my_server

## Environment configuration

Before starting the application you **must** set a strong `JWT_SECRET` environment variable. The server loads this value on startup and will exit if it is missing to prevent running with an insecure default.

Example (`.env` file):

```
JWT_SECRET="a-very-long-random-string-with-symbols-and-numbers"
```

Choose a high-entropy string (at least 32 characters mixing upper/lower case letters, numbers, and symbols) and keep it private.
