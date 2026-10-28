'use client';

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button, Loading } from "@carbon/react";
import { Login } from "@carbon/icons-react";
import { Suspense, useState } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      await signIn("appid", { callbackUrl });
    } catch (error) {
      console.error("Login error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#ffffff",
        padding: "2rem",
      }}
    >
      <div
        style={{
          background: "#f4f4f4",
          padding: "3rem",
          borderRadius: "4px",
          border: "1px solid #e0e0e0",
          maxWidth: "400px",
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: "600", marginBottom: "0.5rem", color: "#161616" }}>
            Network Rail Gap Detection
          </h1>
          <p style={{ color: "#525252", fontSize: "0.875rem" }}>
            Sign in to access the dashboard
          </p>
        </div>

        {isLoading ? (
          <Loading description="Signing in..." withOverlay={false} />
        ) : (
          <Button
            kind="primary"
            size="lg"
            onClick={handleLogin}
            renderIcon={Login}
            style={{ width: "100%" }}
          >
            Sign in with IBM App ID
          </Button>
        )}

        <p
          style={{
            marginTop: "2rem",
            fontSize: "0.75rem",
            color: "#8d8d8d",
          }}
        >
          Secure authentication powered by IBM Cloud App ID
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading description="Loading..." />}>
      <LoginContent />
    </Suspense>
  );
}
