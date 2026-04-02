export interface FeedbackMessage {
	text: string;
	class: string;
}

const MESSAGES: { min: number; text: string; class: string }[] = [
	{ min: 95, text: 'Perfect!', class: 'perfect' },
	{ min: 85, text: 'Great!', class: 'great' },
	{ min: 70, text: 'Nice!', class: 'nice' },
	{ min: 50, text: 'Good!', class: 'good' },
	{ min: 30, text: 'OK!', class: 'ok' },
	{ min: 0, text: 'Try again...', class: 'retry' },
];

export function getFeedback(score: number): FeedbackMessage {
	for (const m of MESSAGES) {
		if (score >= m.min) return { text: m.text, class: m.class };
	}
	return MESSAGES[MESSAGES.length - 1];
}
