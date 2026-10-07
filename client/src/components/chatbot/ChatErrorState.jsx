import { Alert, Button } from "@mui/material";

// Shown for the last failed send. role="alert" makes screen readers announce it.
export default function ChatErrorState({ error, onRetry }) {
  if (!error) return null;
  return (
    <Alert
      severity="error"
      role="alert"
      sx={{ mt: 1 }}
      action={
        error.retryable ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {error.message}
    </Alert>
  );
}
