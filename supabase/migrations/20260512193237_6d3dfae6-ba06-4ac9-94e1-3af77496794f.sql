DO $$
DECLARE
  _uid uuid;
  _org_id uuid;
  _exists uuid;
BEGIN
  SELECT id INTO _exists FROM auth.users WHERE lower(email)='wesleysantos@pevermeio.com';
  IF _exists IS NULL THEN
    _uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
      'wesleysantos@pevermeio.com',
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
      jsonb_build_object('full_name','Wesley Santos'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), _uid, jsonb_build_object('sub', _uid::text, 'email','wesleysantos@pevermeio.com'),
            'email', 'wesleysantos@pevermeio.com', now(), now(), now());
  ELSE
    _uid := _exists;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES ('Pé Vermeio', 'pe-vermeio', _uid)
  RETURNING id INTO _org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (_org_id, _uid, 'owner');
END $$;

SELECT o.id, o.name, o.slug, u.email
FROM public.organizations o JOIN auth.users u ON u.id = o.owner_id
WHERE o.slug = 'pe-vermeio';