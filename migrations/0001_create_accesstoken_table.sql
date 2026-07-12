-- Migration number: 0001 	 2026-07-12T17:48:05.440Z
CREATE TABLE RefreshTokens (Id INTEGER PRIMARY KEY, RetrievedTime TIMESTAMP, ExpiresTime TIMESTAMP, AccessToken TEXT, RefreshToken TEXT);
