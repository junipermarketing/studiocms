import { verifyUsernameInput } from 'studiocms:auth/lib/user';
import { apiResponseLogger } from 'studiocms:logger';
import { sendMail, verifyMailConnection } from 'studiocms:mailer';
import getTemplate from 'studiocms:mailer/templates';
import { sendAdminNotification } from 'studiocms:notifier';
import studioCMS_SDK from 'studiocms:sdk';
import type { APIContext, APIRoute } from 'astro';
import { z } from 'astro/zod';

type JSONData = {
	username: string | undefined;
	email: string | undefined;
	displayname: string | undefined;
	rank: 'owner' | 'admin' | 'editor' | 'visitor' | undefined;
	originalUrl: string;
};

const noMailerError = (message: string, resetLink: URL) =>
	`Failed to send email: ${message}. You can provide the following Reset link to your User: ${resetLink}`;

export const POST: APIRoute = async (context: APIContext) => {
	const siteConfig = context.locals.siteConfig.data;

	if (!siteConfig) {
		return apiResponseLogger(500, 'Failed to get site config');
	}

	// Get user data
	const userData = context.locals.userSessionData;

	// Check if user is logged in
	if (!userData.isLoggedIn) {
		return apiResponseLogger(403, 'Unauthorized');
	}

	// Check if user has permission
	const isAuthorized = context.locals.userPermissionLevel.isAdmin;
	if (!isAuthorized) {
		return apiResponseLogger(403, 'Unauthorized');
	}

	const jsonData: JSONData = await context.request.json();

	const { username, email, displayname, rank, originalUrl } = jsonData;

	// If the username, password, email, or display name is missing, return an error
	if (!username) {
		return apiResponseLogger(400, 'Missing field: Username is required');
	}

	if (!email) {
		return apiResponseLogger(400, 'Missing field: Email is required');
	}

	if (!displayname) {
		return apiResponseLogger(400, 'Missing field: Display name is required');
	}

	if (!rank) {
		return apiResponseLogger(400, 'Missing field: Rank is required');
	}

	// If the username is invalid, return an error
	const verifyUsernameResponse = verifyUsernameInput(username);
	if (verifyUsernameResponse !== true) {
		return apiResponseLogger(400, verifyUsernameResponse);
	}

	// If the email is invalid, return an error
	const checkEmail = z.coerce
		.string()
		.email({ message: 'Email address is invalid' })
		.safeParse(email);

	if (!checkEmail.success) {
		return apiResponseLogger(400, `Invalid email: ${checkEmail.error.message}`);
	}

	const { usernameSearch, emailSearch } =
		await studioCMS_SDK.AUTH.user.searchUsersForUsernameOrEmail(username, checkEmail.data);

	if (usernameSearch.length > 0) {
		return apiResponseLogger(400, 'Invalid username: Username is already in use');
	}

	if (emailSearch.length > 0) {
		return apiResponseLogger(400, 'Invalid email: Email is already in use');
	}

	function generateResetLink(token: {
		id: string;
		userId: string;
		token: string;
	}) {
		const url = new URL(
			`${context.locals.routeMap.mainLinks.dashboardIndex}/password-reset`,
			originalUrl
		);
		url.searchParams.append('userid', token.userId);
		url.searchParams.append('token', token.token);
		url.searchParams.append('id', token.id);

		return url;
	}

	// Creates a new user invite
	const newUser = await studioCMS_SDK.AUTH.user.create(
		{
			username,
			// @ts-expect-error drizzle broke the variable...
			email: checkEmail.data,
			name: displayname,
			createdAt: new Date(),
			id: crypto.randomUUID(),
		},
		rank
	);

	const token = await studioCMS_SDK.resetTokenBucket.new(newUser.id);

	if (!token) {
		return apiResponseLogger(500, 'Failed to create reset token');
	}

	const resetLink = generateResetLink(token);

	await sendAdminNotification('new_user', newUser.username);

	if (siteConfig.enableMailer) {
		const checkMailConnection = await verifyMailConnection();

		if (!checkMailConnection) {
			return apiResponseLogger(500, noMailerError('Failed to connect to mail server', resetLink));
		}

		if ('error' in checkMailConnection) {
			return apiResponseLogger(500, noMailerError('Failed to connect to mail server', resetLink));
		}

		const htmlTemplate = getTemplate('userInvite');

		const mailResponse = await sendMail({
			to: checkEmail.data,
			subject: `You have been invited to join ${siteConfig.title}!`,
			html: htmlTemplate({ title: siteConfig.title, link: resetLink }),
		});

		if (!mailResponse) {
			return apiResponseLogger(500, noMailerError('Failed to send email', resetLink));
		}

		if ('error' in mailResponse) {
			return apiResponseLogger(500, noMailerError(mailResponse.error, resetLink));
		}

		return apiResponseLogger(200, 'User invite created and email sent');
	}

	return apiResponseLogger(200, resetLink.toString());
};

export const OPTIONS: APIRoute = async () => {
	return new Response(null, {
		status: 204,
		statusText: 'No Content',
		headers: {
			Allow: 'OPTIONS, POST',
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
