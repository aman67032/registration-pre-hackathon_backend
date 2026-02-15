import { Router, Request, Response } from 'express';
import { Team } from '../models/Team';
import { connectDB } from '../db';


const router = Router();

const isValidJKLUEmail = (email: string): boolean => {
    return /^[^\s@]+@jklu\.edu\.in$/i.test(email);
};

const isValidWhatsApp = (phone: string): boolean => {
    return /^\d{10}$/.test(phone.replace(/[\s\-\+]/g, '').slice(-10));
};

router.post('/register', async (req: Request, res: Response): Promise<void> => {
    try {
        await connectDB(); // Ensure DB is connected

        const {
            teamName,
            leaderName,
            leaderEmail,
            leaderWhatsApp,
            leaderRollNumber,
            leaderResidency,
            members,
        } = req.body;
        // ... (rest of validation same as before) ...
        const team = new Team({
            teamName: teamName.trim(),
            leaderName: leaderName.trim(),
            leaderEmail: leaderEmail.trim().toLowerCase(),
            leaderWhatsApp: leaderWhatsApp.trim(),
            leaderRollNumber: leaderRollNumber.trim().toUpperCase(),
            leaderResidency: leaderResidency,
            members: members.map((m: any) => ({
                name: m.name.trim(),
                email: m.email.trim().toLowerCase(),
                whatsApp: m.whatsApp.trim(),
                rollNumber: m.rollNumber.trim().toUpperCase(),
                residency: m.residency,
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
        // Return actual error message for debugging
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'production'
                ? 'Server error. Please try again later.'
                : `Server error: ${error.message}`
        });
    }
});

export default router;
