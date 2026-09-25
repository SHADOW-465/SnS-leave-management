-- Sign-in name, distinct from work email. People can use username, email, or employee ID.
ALTER TABLE user_account ADD COLUMN username TEXT;
UPDATE user_account SET username = replace(lower(email), '@', '.') WHERE username IS NULL OR username = '';
CREATE UNIQUE INDEX IF NOT EXISTS user_account_username ON user_account (username);
