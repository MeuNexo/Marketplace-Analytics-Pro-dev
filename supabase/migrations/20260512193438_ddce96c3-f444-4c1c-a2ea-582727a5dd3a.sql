UPDATE auth.users
SET encrypted_password = crypt('pP123456*', gen_salt('bf')),
    updated_at = now()
WHERE lower(email) = 'wesleysantos@pevermeio.com';