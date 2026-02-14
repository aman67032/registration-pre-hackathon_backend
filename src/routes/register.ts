import { Router, Request, Response } from 'express';
import { Team } from '../models/Team';

const router = Router();

const isValidJKLUEmail = (email: string): boolean => {
    return /^[^\s@]+@jklu\.edu\.in$/i.test(email);
};

const isValidWhatsApp = (phone: string): boolean => {
    return /^\d{10}$/.test(phone.replace(/[\s\-\+]/g, '').slice(-10));
};

router.post('/register', async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            teamName,
            leaderName,
            leaderEmail,
            leaderWhatsApp,
            leaderRollNumber,
            members,
        } = req.body;

        // --- Validate required fields ---
        if (!teamName || !leaderName || !leaderEmail || !leaderWhatsApp || !leaderRollNumber) {
            res.status(400).json({ success: false, message: 'All team leader fields are required.' });
            return;
        }

        if (!members || !Array.isArray(members) || members.length !== 3) {
            res.status(400).json({ success: false, message: 'Exactly 3 team members are required.' });
            return;
        }

        // --- Validate leader email ---
        if (!isValidJKLUEmail(leaderEmail)) {
            res.status(400).json({ success: false, message: 'Team leader must use a valid @jklu.edu.in email.' });
            return;
        }

        // --- Validate each member ---
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            if (!m.name || !m.email || !m.whatsApp || !m.rollNumber) {
                res.status(400).json({ success: false, message: `All fields for Team Member ${i + 1} are required.` });
                return;
            }
            if (!isValidJKLUEmail(m.email)) {
                res.status(400).json({ success: false, message: `Team Member ${i + 1} must use a valid @jklu.edu.in email.` });
                return;
            }
        }

        // --- Check for duplicate team name ---
        const existingTeam = await Team.findOne({ teamName: { $regex: new RegExp(`^${teamName.trim()}$`, 'i') } });
        if (existingTeam) {
            res.status(409).json({ success: false, message: 'A team with this name already exists. Please choose a different name.' });
            return;
        }

        // --- Check for duplicate emails/roll numbers ---
        const allEmails = [leaderEmail, ...members.map((m: any) => m.email)].map((e: string) => e.toLowerCase());
        const uniqueEmails = new Set(allEmails);
        if (uniqueEmails.size !== allEmails.length) {
            res.status(400).json({ success: false, message: 'Duplicate email addresses found. Each member must have a unique email.' });
            return;
        }

        const allRolls = [leaderRollNumber, ...members.map((m: any) => m.rollNumber)].map((r: string) => r.toUpperCase());
        const uniqueRolls = new Set(allRolls);
        if (uniqueRolls.size !== allRolls.length) {
            res.status(400).json({ success: false, message: 'Duplicate roll numbers found. Each member must have a unique roll number.' });
            return;
        }

        // --- Create team ---
        const team = new Team({
            teamName: teamName.trim(),
            leaderName: leaderName.trim(),
            leaderEmail: leaderEmail.trim().toLowerCase(),
            leaderWhatsApp: leaderWhatsApp.trim(),
            leaderRollNumber: leaderRollNumber.trim().toUpperCase(),
            members: members.map((m: any) => ({
                name: m.name.trim(),
                email: m.email.trim().toLowerCase(),
                whatsApp: m.whatsApp.trim(),
                rollNumber: m.rollNumber.trim().toUpperCase(),
            })),
        });

        await team.save();

        res.status(201).json({
            success: true,
            message: 'Team registered successfully! 🎉',
            data: { teamName: team.teamName, id: team._id },
        });
    } catch (error: any) {
        console.error('Registration error:', error);
        if (error.code === 11000) {
            res.status(409).json({ success: false, message: 'A team with this name already exists.' });
            return;
        }
        res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
    }
});

export default router;
