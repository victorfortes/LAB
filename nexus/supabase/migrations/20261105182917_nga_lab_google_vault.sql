-- Credenciais do escritório: disponíveis somente ao servidor que usa nga_app.
-- Vault cifra em repouso. A view descriptografada permanece sem acesso para nga_app.
CREATE OR REPLACE FUNCTION nga_lab.configuracao_google_servidor()
RETURNS TABLE(chave text, valor text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE name
  WHEN 'nga_lab_google_client_id' THEN 'NGA_GOOGLE_CLIENT_ID'
  WHEN 'nga_lab_google_client_secret' THEN 'NGA_GOOGLE_CLIENT_SECRET'
  WHEN 'nga_lab_google_redirect_uri' THEN 'NGA_GOOGLE_REDIRECT_URI'
  WHEN 'nga_lab_google_token_key' THEN 'NGA_GOOGLE_TOKEN_KEY'
 END, decrypted_secret
 FROM vault.decrypted_secrets
 WHERE name IN ('nga_lab_google_client_id','nga_lab_google_client_secret','nga_lab_google_redirect_uri','nga_lab_google_token_key')
$$;
REVOKE ALL ON FUNCTION nga_lab.configuracao_google_servidor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nga_lab.configuracao_google_servidor() TO nga_app;
