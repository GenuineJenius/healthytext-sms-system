class VCardGenerator {
    constructor(options = {}) {
        this.contactInfo = {
            name: options.name || 'HealthyText',
            organization: options.organization || 'HealthyText Wellness',
            phone: options.phone || '+18338587803',
            email: options.email || 'support@healthytexts.com',
            website: options.website || 'https://healthytexts.com',
            note: options.note || 'Your wellness messaging companion'
        };
        
        console.log('📇 vCard Generator initialized for HealthyText');
    }

    // Generate vCard content
    generateVCard() {
        const vcard = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${this.contactInfo.name}`,
            `ORG:${this.contactInfo.organization}`,
            `TEL;TYPE=VOICE,WORK:${this.contactInfo.phone}`,
            `EMAIL;TYPE=WORK:${this.contactInfo.email}`,
            `URL:${this.contactInfo.website}`,
            `NOTE:${this.contactInfo.note}`,
            'END:VCARD'
        ].join('\\n');
        
        return vcard;
    }

    // Create vCard file (for hosting)
    async createVCardFile(filePath) {
        const fs = require('fs').promises;
        const vCardContent = this.generateVCard();
        
        try {
            await fs.writeFile(filePath, vCardContent, 'utf8');
            console.log(`📇 vCard file created: ${filePath}`);
            return filePath;
        } catch (error) {
            console.error('❌ Failed to create vCard file:', error);
            throw error;
        }
    }

    // Get vCard as attachment for Twilio MMS
    getVCardForMMS() {
        // For MMS, we need a publicly accessible URL to the vCard file
        // This will be the URL where your vCard file is hosted
        return {
            contentType: 'text/vcard',
            filename: 'HealthyText-Contact.vcf',
            content: this.generateVCard()
        };
    }

    // Update contact information
    updateContactInfo(newInfo) {
        this.contactInfo = { ...this.contactInfo, ...newInfo };
        console.log('📇 Contact info updated:', newInfo);
    }
}

module.exports = VCardGenerator;