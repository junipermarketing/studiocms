import { createUserSession } from 'studiocms:auth/lib/session';
import { LinkNewOAuthCookieName, createOAuthUser, getUserData } from 'studiocms:auth/lib/user';
import { isEmailVerified, sendVerificationEmail } from 'studiocms:auth/lib/verify-email';
import { config } from 'studiocms:config';
import studioCMS_SDK from 'studiocms:sdk';
import { OAuth2RequestError, type OAuth2Tokens } from 'arctic';
import type { APIContext, APIRoute } from 'astro';
import { type GitHubUser, ProviderCookieName, ProviderID, github } from './shared.js';

export const GET: APIRoute = async (context: APIContext): Promise<Response> => {
	const { url, cookies, redirect } = context;

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get(ProviderCookieName)?.value ?? null;

	if (!code || !state || !storedState || state !== storedState) {
		return redirect(context.locals.routeMap.authLinks.loginURL);
	}

	let tokens: OAuth2Tokens;

	try {
		tokens = await github.validateAuthorizationCode(code);

		const githubUserResponse = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`,
			},
		});

		const githubUser: GitHubUser = await githubUserResponse.json();
		const githubUserId = githubUser.id;
		const githubUsername = githubUser.login;

		const existingOAuthAccount = await studioCMS_SDK.AUTH.oAuth.searchProvidersForId(
			ProviderID,
			`${githubUserId}`
		);

		if (existingOAuthAccount) {
			const user = await studioCMS_SDK.GET.databaseEntry.users.byId(existingOAuthAccount.userId);

			if (!user) {
				return new Response('User not found', {
					status: 404,
				});
			}

			const existingUser = await studioCMS_SDK.GET.databaseEntry.users.byId(user.id);

			const isEmailAccountVerified = await isEmailVerified(existingUser);

			// If Mailer is enabled, is the user verified?
			if (!isEmailAccountVerified) {
				return new Response('Email not verified, please verify your account first.', {
					status: 400,
				});
			}

			await createUserSession(user.id, context);

			return redirect(context.locals.routeMap.mainLinks.dashboardIndex);
		}

		const loggedInUser = await getUserData(context);
		const linkNewOAuth = !!cookies.get(LinkNewOAuthCookieName)?.value;

		if (loggedInUser.user && linkNewOAuth) {
			const existingUser = await studioCMS_SDK.GET.databaseEntry.users.byId(loggedInUser.user.id);

			if (existingUser) {
				await studioCMS_SDK.AUTH.oAuth.create({
					userId: existingUser.id,
					provider: ProviderID,
					providerUserId: `${githubUserId}`,
				});

				const isEmailAccountVerified = await isEmailVerified(existingUser);

				// If Mailer is enabled, is the user verified?
				if (!isEmailAccountVerified) {
					return new Response('Email not verified, please verify your account first.', {
						status: 400,
					});
				}

				await createUserSession(existingUser.id, context);

				return redirect(context.locals.routeMap.mainLinks.dashboardIndex);
			}
		}

		const newUser = await createOAuthUser(
			{
				// @ts-expect-error drizzle broke the id variable...
				id: crypto.randomUUID(),
				username: githubUsername,
				email: githubUser.email,
				name: githubUser.name,
				avatar: githubUser.avatar_url,
				createdAt: new Date(),
				url: githubUser.blog,
			},
			{ provider: ProviderID, providerUserId: `${githubUserId}` }
		);

		if ('error' in newUser) {
			return new Response('Error creating user', { status: 500 });
		}

		// FIRST-TIME-SETUP
		if (config.dbStartPage) {
			return redirect('/done');
		}

		await sendVerificationEmail(newUser.id, true);

		const existingUser = await studioCMS_SDK.GET.databaseEntry.users.byId(newUser.id);

		const isEmailAccountVerified = await isEmailVerified(existingUser);

		// If Mailer is enabled, is the user verified?
		if (!isEmailAccountVerified) {
			return new Response('Email not verified, please verify your account first.', { status: 400 });
		}

		await createUserSession(newUser.id, context);

		return redirect(context.locals.routeMap.mainLinks.dashboardIndex);
	} catch (e) {
		if (e instanceof OAuth2RequestError) {
			const code = e.code;
			return new Response(code, {
				status: 400,
			});
		}
		return new Response(null, {
			status: 400,
		});
	}
};

export const OPTIONS: APIRoute = async () => {
	return new Response(null, {
		status: 204,
		statusText: 'No Content',
		headers: {
			Allow: 'OPTIONS, GET',
			'ALLOW-ACCESS-CONTROL-ORIGIN': '*',
			'Cache-Control': 'public, max-age=604800, immutable',
			Date: new Date().toUTCString(),
		},
	});
};

export const ALL: APIRoute = async () => {
	return new Response(null, {
		status: 405,
		statusText: 'Method Not Allowed',
		headers: {
			'ACCESS-CONTROL-ALLOW-ORIGIN': '*',
		},
	});
};
