import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Team } from '../models/Team';

dotenv.config();

async function checkDuplicateEmails() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI not set in .env');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected to MongoDB\n');

    const teams = await Team.find({});
    console.log(`Total teams: ${teams.length}\n`);

    // Collect all emails with their team info
    const emailMap = new Map<string, string[]>(); // email -> [teamName, ...]

    for (const team of teams) {
        const emails = [
            { email: team.leaderEmail, role: `Leader of "${team.teamName}"` },
            ...team.members.map((m, i) => ({ email: m.email, role: `Member ${i + 1} of "${team.teamName}"` })),
        ];

        for (const { email, role } of emails) {
            const normalized = email.toLowerCase().trim();
            if (!emailMap.has(normalized)) {
                emailMap.set(normalized, []);
            }
            emailMap.get(normalized)!.push(role);
        }
    }

    // Find duplicates (emails appearing in more than one team)
    const duplicates = [...emailMap.entries()].filter(([, roles]) => roles.length > 1);

    if (duplicates.length === 0) {
        console.log('✅ No duplicate emails found across teams!');
    } else {
        console.log(`⚠️  Found ${duplicates.length} duplicate email(s):\n`);
        for (const [email, roles] of duplicates) {
            console.log(`  📧 ${email}`);
            for (const role of roles) {
                console.log(`     - ${role}`);
            }
            console.log('');
        }
    }

    await mongoose.disconnect();
}

checkDuplicateEmails().catch(console.error);
