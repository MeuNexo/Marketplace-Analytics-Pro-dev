import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

/**
 * Detects OAuth `code` param on any page and redirects to /integracoes
 * preserving the code so it can be exchanged for a token.
 */
export function OAuthCodeRedirect({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const path = window.location.pathname;
    if (code && path !== "/integracoes") {
      const params = new URLSearchParams({ code });
      if (state) params.set("state", state);
      navigate(`/integracoes?${params.toString()}`, { replace: true });
    }
  }, [searchParams, navigate]);

  return <>{children}</>;
}
