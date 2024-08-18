import React from "react";
import { authorizationEndpoint, clientId, possible, redirectUrl, scope } from "../const/spotify";






export async function redirectToSpotifyAuthorize() {
  
    const randomValues = crypto.getRandomValues(new Uint8Array(64));
    const randomString = randomValues.reduce((acc, x) => acc + possible[x % possible.length], "");
  
    const code_verifier = randomString;
    const data = new TextEncoder().encode(code_verifier);
    const hashed = await crypto.subtle.digest('SHA-256', data);
    const hashed_8bits = new Uint8Array(hashed);
  
    const code_challenge_base64 = btoa(String.fromCharCode(...Array.from(hashed_8bits)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  
    window.localStorage.setItem('code_verifier', code_verifier);
  
    const authUrl = new URL(authorizationEndpoint)
    const params = {
      response_type: 'code',
      client_id: clientId,
      scope: scope,
      code_challenge_method: 'S256',
      code_challenge: code_challenge_base64,
      redirect_uri: redirectUrl,
    };
  
    authUrl.search = new URLSearchParams(params).toString();
    window.location.href = authUrl.toString(); // Redirect the user to the authorization server for login
}




// Data structure that manages the current active token, caching it in localStorage
export  const currentToken = {
    get access_token() { return localStorage.getItem('access_token') || null; },
    get refresh_token() { return localStorage.getItem('refresh_token') || null; },
    get expires_in() { return localStorage.getItem('refresh_in') || null },
    get expires() { return localStorage.getItem('expires') || null },
  
    save: function (response:any) {
      const { access_token, refresh_token, expires_in } = response;
      console.log("Saving token: " + access_token + " " + refresh_token + " " + expires_in);
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
      localStorage.setItem('expires_in', expires_in);
  
      const now = new Date();
      const expiry = new Date(now.getTime() + (expires_in * 1000)).toDateString();
      localStorage.setItem('expires', expiry);
    }
  };