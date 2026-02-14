import mongoose, { Schema, Document } from 'mongoose';

interface IMember {
    name: string;
    email: string;
    whatsApp: string;
    rollNumber: string;
}

export interface ITeam extends Document {
    teamName: string;
    leaderName: string;
    leaderEmail: string;
    leaderWhatsApp: string;
    leaderRollNumber: string;
    members: IMember[];
    createdAt: Date;
}

const MemberSchema = new Schema<IMember>({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    whatsApp: { type: String, required: true, trim: true },
    rollNumber: { type: String, required: true, trim: true, uppercase: true },
});

const TeamSchema = new Schema<ITeam>(
    {
        teamName: { type: String, required: true, trim: true, unique: true },
        leaderName: { type: String, required: true, trim: true },
        leaderEmail: { type: String, required: true, trim: true, lowercase: true },
        leaderWhatsApp: { type: String, required: true, trim: true },
        leaderRollNumber: { type: String, required: true, trim: true, uppercase: true },
        members: {
            type: [MemberSchema],
            validate: {
                validator: (v: IMember[]) => v.length === 3,
                message: 'Exactly 3 team members are required',
            },
        },
    },
    {
        timestamps: true,
    }
);

// Use the specific collection name requested
export const Team = mongoose.model<ITeam>('Team', TeamSchema, 'Data_Collection_Pre-Hackthon_1');
